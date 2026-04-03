import type { ProviderAdapter, ProxyUsage } from "./types.js";

function extractCacheUsage(u: Record<string, unknown>): ProxyUsage {
  const cacheRead = Number(u.cache_read_input_tokens ?? 0) || Number((u.prompt_tokens_details as Record<string, unknown>)?.cached_tokens ?? 0);
  const cacheCreation = Number(u.cache_creation_input_tokens ?? 0);
  const rawInput = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
  // inputTokens = non-cached portion; if raw already excludes cache, use as-is
  // OpenAI: prompt_tokens includes cached; Anthropic: input_tokens excludes cached
  // For safety: if rawInput >= cacheRead, subtract; otherwise treat rawInput as non-cached
  const inputTokens = (rawInput >= cacheRead && cacheRead > 0) ? rawInput - cacheRead : rawInput || (cacheRead + cacheCreation);
  const outputTokens = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  const totalTokens = Number(u.total_tokens ?? 0) || (inputTokens + cacheRead + cacheCreation + outputTokens);

  return { inputTokens, outputTokens, totalTokens, cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreation };
}

export const openaiAdapter: ProviderAdapter = {
  formatId: "openai",

  buildUrl(baseUrl: string): string {
    const base = baseUrl.replace(/\/+$/, "");
    return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  },

  buildHeaders(apiKey: string, defaultUserAgent?: string): Record<string, string> {
    return {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
      "user-agent": defaultUserAgent || "xllmapi/1.0",
    };
  },

  prepareBody(body: Record<string, unknown>, realModel: string): Record<string, unknown> {
    const prepared: Record<string, unknown> = { ...body, model: realModel };
    // No longer cap max_tokens — let upstream providers enforce their own limits
    // Ensure streaming responses include token usage for billing
    if (prepared.stream === true && !prepared.stream_options) {
      prepared.stream_options = { include_usage: true };
    }
    return prepared;
  },

  extractUsageFromStream(tail: string): ProxyUsage | undefined {
    const lines = tail.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (!line.startsWith("data:") || !line.includes('"usage"')) continue;
      const jsonStr = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.usage) {
          return extractCacheUsage(parsed.usage as Record<string, unknown>);
        }
      } catch { /* skip */ }
    }
    return undefined;
  },

  extractUsageFromJson(body: unknown): ProxyUsage | undefined {
    const parsed = body as Record<string, unknown>;
    const u = parsed?.usage as Record<string, unknown> | undefined;
    if (u) {
      return extractCacheUsage(u);
    }
    return undefined;
  },
};
