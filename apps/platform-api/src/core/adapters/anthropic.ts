import type { ProviderAdapter, ProxyUsage } from "./types.js";
import { parseRawUsage, mergeUsage, ZERO_USAGE } from "./usage-parser.js";

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
    let accumulated = { ...ZERO_USAGE };
    let found = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      try {
        const parsed = JSON.parse(jsonStr);
        // message_start: { message: { usage: {...} } }
        if (parsed.type === "message_start" && parsed.message?.usage) {
          const eventUsage = parseRawUsage(parsed.message.usage as Record<string, unknown>, "anthropic");
          accumulated = mergeUsage(accumulated, eventUsage);
          found = true;
        }
        // message_delta: { usage: {...} } — some providers also report input here
        if (parsed.type === "message_delta" && parsed.usage) {
          const eventUsage = parseRawUsage(parsed.usage as Record<string, unknown>, "anthropic");
          accumulated = mergeUsage(accumulated, eventUsage);
          found = true;
        }
      } catch { /* skip */ }
    }

    return found ? accumulated : undefined;
  },

  extractUsageFromJson(body: unknown): ProxyUsage | undefined {
    const parsed = body as Record<string, unknown>;
    const u = parsed?.usage as Record<string, unknown> | undefined;
    if (u) {
      return parseRawUsage(u, "anthropic");
    }
    return undefined;
  },
};
