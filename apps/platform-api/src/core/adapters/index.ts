export type { ProviderAdapter, ProviderHooks, ProxyUsage, ApiFormatId } from "./types.js";
export { openaiAdapter } from "./openai.js";
export { anthropicAdapter } from "./anthropic.js";
export { convertRequestBody } from "./converter.js";
export { convertJsonResponse, createStreamConverter } from "./response-converter.js";
export { parseRawUsage, mergeUsage, ZERO_USAGE } from "./usage-parser.js";

import type { ApiFormatId, ProviderAdapter, ProviderHooks } from "./types.js";
import { openaiAdapter } from "./openai.js";
import { anthropicAdapter } from "./anthropic.js";

const registry = new Map<ApiFormatId, ProviderAdapter>([
  ["openai", openaiAdapter],
  ["anthropic", anthropicAdapter],
]);

/** Get adapter for a given API format. Throws if not found. */
export function getAdapter(formatId: ApiFormatId): ProviderAdapter {
  const adapter = registry.get(formatId);
  if (!adapter) throw new Error(`No adapter registered for format: ${formatId}`);
  return adapter;
}

/** Register a custom adapter (for future extensibility). */
export function registerAdapter(adapter: ProviderAdapter): void {
  registry.set(adapter.formatId, adapter);
}

// ── Provider Hooks: per-provider overrides on top of format adapters ──

const providerHooksRegistry = new Map<string, { openai?: ProviderHooks; anthropic?: ProviderHooks }>();
const compatModeRegistry = new Map<string, { openai?: ProviderHooks; anthropic?: ProviderHooks }>();

/** Register provider-specific hooks by label (legacy, still supported) */
export function registerProviderHooks(
  providerLabel: string,
  hooks: { openai?: ProviderHooks; anthropic?: ProviderHooks },
): void {
  providerHooksRegistry.set(providerLabel.toLowerCase(), hooks);
}

/** Register hooks by compat_mode value (preferred — config-driven, not name-dependent) */
export function registerCompatModeHooks(
  semantics: string,
  hooks: { openai?: ProviderHooks; anthropic?: ProviderHooks },
): void {
  compatModeRegistry.set(semantics, hooks);
}

/**
 * Get adapter with provider-specific hooks applied.
 * Priority: compatMode hooks → providerLabel hooks → base adapter
 */
export function getAdapterForProvider(formatId: ApiFormatId, providerLabel?: string, compatMode?: string): ProviderAdapter {
  const base = getAdapter(formatId);

  // Priority 1: compat_mode from DB config (stable, not name-dependent)
  const semHooks = compatMode ? compatModeRegistry.get(compatMode)?.[formatId] : undefined;
  // Priority 2: provider label matching (legacy fallback)
  const labelHooks = providerLabel ? providerHooksRegistry.get(providerLabel.toLowerCase())?.[formatId] : undefined;
  const hooks = semHooks ?? labelHooks;
  if (!hooks) return base;

  return {
    formatId: base.formatId,
    buildUrl: hooks.buildUrl ?? base.buildUrl.bind(base),
    buildHeaders: base.buildHeaders.bind(base),
    prepareBody: hooks.transformBody
      ? (body: Record<string, unknown>, realModel: string) => hooks.transformBody!(base.prepareBody(body, realModel))
      : base.prepareBody.bind(base),
    extractUsageFromStream: hooks.extractUsageFromStream ?? base.extractUsageFromStream.bind(base),
    extractUsageFromJson: hooks.extractUsageFromJson ?? base.extractUsageFromJson.bind(base),
  };
}
