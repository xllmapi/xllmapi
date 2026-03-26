export type { ProviderAdapter, ProxyUsage, ApiFormatId } from "./types.js";
export { openaiAdapter } from "./openai.js";
export { anthropicAdapter } from "./anthropic.js";
export { convertRequestBody } from "./converter.js";
export { convertJsonResponse, createStreamConverter } from "./response-converter.js";

import type { ApiFormatId, ProviderAdapter } from "./types.js";
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
