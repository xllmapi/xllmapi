import type { ProviderAdapter, ProxyUsage } from "./types.js";

function extractAnthropicUsage(u: Record<string, number>): ProxyUsage {
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheCreation = u.cache_creation_input_tokens ?? 0;
  // Anthropic: input_tokens = non-cached portion (separate from cache fields)
  const inputTokens = u.input_tokens || u.prompt_tokens || 0;
  const outputTokens = u.output_tokens ?? u.completion_tokens ?? 0;
  const totalTokens = u.total_tokens ?? (inputTokens + cacheRead + cacheCreation + outputTokens);

  return { inputTokens, outputTokens, totalTokens, cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreation };
}

export const anthropicAdapter: ProviderAdapter = {
  formatId: "anthropic",

  buildUrl(baseUrl: string): string {
    const base = baseUrl.replace(/\/+$/, "");
    return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
  },

  buildHeaders(apiKey: string, defaultUserAgent?: string): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "user-agent": defaultUserAgent || "xllmapi/1.0",
    };
  },

  prepareBody(body: Record<string, unknown>, realModel: string): Record<string, unknown> {
    return { ...body, model: realModel };
  },

  extractUsageFromStream(tail: string): ProxyUsage | undefined {
    const lines = tail.split("\n");
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let cacheCreation = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.type === "message_start" && parsed.message?.usage) {
          const u = parsed.message.usage;
          inputTokens = u.input_tokens || u.prompt_tokens || 0;
          cacheRead = u.cache_read_input_tokens ?? 0;
          cacheCreation = u.cache_creation_input_tokens ?? 0;
        }
        // Some providers (MiMo, hanbbq) report input_tokens in message_delta
        if (parsed.type === "message_delta" && parsed.usage) {
          outputTokens = parsed.usage.output_tokens ?? 0;
          const deltaInput = parsed.usage.input_tokens || 0;
          if (deltaInput > inputTokens) inputTokens = deltaInput;
          const deltaCacheRead = parsed.usage.cache_read_input_tokens ?? 0;
          if (deltaCacheRead > cacheRead) cacheRead = deltaCacheRead;
          const deltaCacheCreation = parsed.usage.cache_creation_input_tokens ?? 0;
          if (deltaCacheCreation > cacheCreation) cacheCreation = deltaCacheCreation;
        }
      } catch { /* skip */ }
    }

    if (inputTokens > 0 || outputTokens > 0 || cacheRead > 0 || cacheCreation > 0) {
      return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + cacheRead + cacheCreation + outputTokens,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
      };
    }
    return undefined;
  },

  extractUsageFromJson(body: unknown): ProxyUsage | undefined {
    const parsed = body as Record<string, unknown>;
    const u = parsed?.usage as Record<string, number> | undefined;
    if (u) {
      return extractAnthropicUsage(u);
    }
    return undefined;
  },
};
