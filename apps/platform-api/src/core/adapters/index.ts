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

/** Register provider-specific hooks that override base adapter behavior */
export function registerProviderHooks(
  providerLabel: string,
  hooks: { openai?: ProviderHooks; anthropic?: ProviderHooks },
): void {
  providerHooksRegistry.set(providerLabel.toLowerCase(), hooks);
}

/** Get adapter with provider-specific hooks applied. Falls back to base adapter if no hooks. */
export function getAdapterForProvider(formatId: ApiFormatId, providerLabel?: string): ProviderAdapter {
  const base = getAdapter(formatId);
  if (!providerLabel) return base;

  const hooks = providerHooksRegistry.get(providerLabel.toLowerCase())?.[formatId];
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
