import type { ProviderHooks } from "../types.js";

/**
 * MiMo Anthropic streaming hook.
 *
 * MiMo's Anthropic endpoint differs from standard Anthropic:
 * - Standard: message_start has input_tokens, message_delta has output_tokens
 * - MiMo: message_start has input_tokens=0, message_delta has BOTH input_tokens and output_tokens
 *
 * The base anthropicAdapter now uses mergeUsage() (take-max) across events,
 * which handles MiMo's behavior correctly. This hook is kept for documentation
 * and in case MiMo needs additional customization in the future.
 */
export const mimoAnthropicHooks: ProviderHooks = {
  // Base adapter's mergeUsage already handles MiMo's multi-event pattern.
  // No custom hooks needed currently — the anthropicAdapter's extractUsageFromStream
  // iterates all events and takes max of each field via mergeUsage().
};
