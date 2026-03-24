import type { ProviderAdapter, ProxyUsage } from "./types.js";

export const openaiAdapter: ProviderAdapter = {
  formatId: "openai",

  buildUrl(baseUrl: string): string {
    const base = baseUrl.replace(/\/+$/, "");
    return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  },

  buildHeaders(apiKey: string): Record<string, string> {
    return {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
      "user-agent": "xllmapi/1.0",
    };
  },

  prepareBody(body: Record<string, unknown>, realModel: string): Record<string, unknown> {
    const prepared: Record<string, unknown> = { ...body, model: realModel };
    if (typeof prepared.max_tokens === "number") {
      prepared.max_tokens = Math.min(prepared.max_tokens as number, 8192);
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
        if (parsed.usage?.prompt_tokens !== undefined) {
          return {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
            totalTokens: parsed.usage.total_tokens ?? 0,
          };
        }
      } catch { /* skip */ }
    }
    return undefined;
  },

  extractUsageFromJson(body: unknown): ProxyUsage | undefined {
    const parsed = body as Record<string, unknown>;
    const usage = parsed?.usage as Record<string, number> | undefined;
    if (usage?.prompt_tokens !== undefined) {
      return {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      };
    }
    return undefined;
  },
};
