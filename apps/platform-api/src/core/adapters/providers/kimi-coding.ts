import type { ProviderHooks, ProxyUsage } from "../types.js";
import { parseRawUsage, mergeUsage, ZERO_USAGE } from "../usage-parser.js";

/**
 * Kimi Code (api.kimi.com/coding/v1) Anthropic endpoint hooks.
 *
 * Problem: Kimi Code returns BOTH Anthropic and OpenAI fields in usage:
 *   { input_tokens: 10100, cache_read_input_tokens: 9700,
 *     prompt_tokens: 10100, cached_tokens: 9700, ... }
 *
 * input_tokens == prompt_tokens means input_tokens INCLUDES cached tokens
 * (OpenAI semantics), not EXCLUDES them (Anthropic standard).
 * This causes double-counting: inputTokens + cacheReadTokens = 2x real input.
 *
 * Fix: detect input_tokens === prompt_tokens && cache_read > 0, then subtract.
 */

function fixKimiUsage(raw: Record<string, unknown>): ProxyUsage {
  const base = parseRawUsage(raw, "anthropic");
  const promptTokens = Number(raw.prompt_tokens ?? 0);

  // Safe: in standard Anthropic, prompt_tokens = input_tokens + cache_read,
  // so input_tokens === prompt_tokens is impossible when cache_read > 0.
  // This condition ONLY matches Kimi's non-standard behavior.
  if (base.cacheReadTokens > 0 && promptTokens > 0 && base.inputTokens === promptTokens) {
    const fixedInput = Math.max(0, base.inputTokens - base.cacheReadTokens);
    return {
      ...base,
      inputTokens: fixedInput,
      totalTokens: fixedInput + base.cacheReadTokens + base.cacheCreationTokens + base.outputTokens,
    };
  }
  return base;
}

export const kimiCodingAnthropicHooks: ProviderHooks = {
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
        if (parsed.type === "message_start" && parsed.message?.usage) {
          accumulated = mergeUsage(accumulated, fixKimiUsage(parsed.message.usage));
          found = true;
        }
        if (parsed.type === "message_delta" && parsed.usage) {
          accumulated = mergeUsage(accumulated, fixKimiUsage(parsed.usage));
          found = true;
        }
      } catch { /* skip */ }
    }
    return found ? accumulated : undefined;
  },

  extractUsageFromJson(body: unknown): ProxyUsage | undefined {
    const parsed = body as Record<string, unknown>;
    const u = parsed?.usage as Record<string, unknown> | undefined;
    if (u) return fixKimiUsage(u);
    return undefined;
  },
};
