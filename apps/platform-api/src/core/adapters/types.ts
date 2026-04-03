/**
 * Provider Adapter interfaces.
 * Each API format (OpenAI, Anthropic, etc.) implements ProviderAdapter.
 * This enables extensible multi-format proxy support.
 */

export type ApiFormatId = "openai" | "anthropic";

export interface ProxyUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ProviderAdapter {
  /** Format identifier */
  readonly formatId: ApiFormatId;

  /** Build the full request URL from a base URL */
  buildUrl(baseUrl: string): string;

  /** Build auth + content-type headers. defaultUserAgent overrides the built-in fallback. */
  buildHeaders(apiKey: string, defaultUserAgent?: string): Record<string, string>;

  /** Transform request body: swap model, clamp limits, etc. No format conversion. */
  prepareBody(body: Record<string, unknown>, realModel: string): Record<string, unknown>;

  /** Extract usage from SSE stream tail buffer */
  extractUsageFromStream(tailBuffer: string): ProxyUsage | undefined;

  /** Extract usage from non-streaming JSON response body */
  extractUsageFromJson(body: unknown): ProxyUsage | undefined;
}

/** Provider-specific hooks that override base adapter behavior for specific providers */
export interface ProviderHooks {
  /** Override usage extraction from SSE stream */
  extractUsageFromStream?: (tail: string) => ProxyUsage | undefined;
  /** Override usage extraction from JSON response */
  extractUsageFromJson?: (body: unknown) => ProxyUsage | undefined;
  /** Transform request body after base prepareBody */
  transformBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  /** Override URL building */
  buildUrl?: (baseUrl: string) => string;
}
