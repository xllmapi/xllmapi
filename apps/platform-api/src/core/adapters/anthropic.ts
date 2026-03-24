import type { ProviderAdapter, ProxyUsage } from "./types.js";

export const anthropicAdapter: ProviderAdapter = {
  formatId: "anthropic",

  buildUrl(baseUrl: string): string {
    const base = baseUrl.replace(/\/+$/, "");
    return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
  },

  buildHeaders(apiKey: string): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "user-agent": "xllmapi/1.0",
    };
  },

  prepareBody(body: Record<string, unknown>, realModel: string): Record<string, unknown> {
    return { ...body, model: realModel };
  },

  extractUsageFromStream(tail: string): ProxyUsage | undefined {
    const lines = tail.split("\n");
    let inputTokens = 0;
    let outputTokens = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      try {
        const parsed = JSON.parse(jsonStr);
        // message_start event: { type: "message_start", message: { usage: { input_tokens } } }
        if (parsed.type === "message_start" && parsed.message?.usage) {
          inputTokens = parsed.message.usage.input_tokens ?? 0;
        }
        // message_delta event: { type: "message_delta", usage: { output_tokens } }
        if (parsed.type === "message_delta" && parsed.usage) {
          outputTokens = parsed.usage.output_tokens ?? 0;
        }
      } catch { /* skip */ }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
    }
    return undefined;
  },

  extractUsageFromJson(body: unknown): ProxyUsage | undefined {
    const parsed = body as Record<string, unknown>;
    const usage = parsed?.usage as Record<string, number> | undefined;
    if (usage?.input_tokens !== undefined) {
      return {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      };
    }
    return undefined;
  },
};
