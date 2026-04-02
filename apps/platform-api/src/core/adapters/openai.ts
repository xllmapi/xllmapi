import type { ProviderAdapter, ProxyUsage } from "./types.js";

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
          const u = parsed.usage;
          const inputTokens = (u.prompt_tokens ?? u.input_tokens ?? ((u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0))) || 0;
          const outputTokens = u.completion_tokens ?? u.output_tokens ?? 0;
          return {
            inputTokens,
            outputTokens,
            totalTokens: u.total_tokens ?? (inputTokens + outputTokens),
          };
        }
      } catch { /* skip */ }
    }
    return undefined;
  },

  extractUsageFromJson(body: unknown): ProxyUsage | undefined {
    const parsed = body as Record<string, unknown>;
    const u = parsed?.usage as Record<string, number> | undefined;
    if (u) {
      const inputTokens = (u.prompt_tokens ?? u.input_tokens ?? ((u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0))) || 0;
      const outputTokens = u.completion_tokens ?? u.output_tokens ?? 0;
      return {
        inputTokens,
        outputTokens,
        totalTokens: u.total_tokens ?? (inputTokens + outputTokens),
      };
    }
    return undefined;
  },
};
