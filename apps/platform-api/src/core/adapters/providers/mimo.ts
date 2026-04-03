import type { ProviderHooks, ProxyUsage } from "../types.js";

/**
 * MiMo Anthropic streaming hook.
 *
 * MiMo's Anthropic endpoint differs from standard Anthropic:
 * - Standard: message_start has input_tokens, message_delta has output_tokens
 * - MiMo: message_start has input_tokens=0, message_delta has BOTH input_tokens and output_tokens
 *
 * This hook extracts input_tokens from message_delta as well as message_start,
 * taking the larger value to handle both standard and MiMo behavior.
 */
export const mimoAnthropicHooks: ProviderHooks = {
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
};
