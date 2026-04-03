export type PricingMode = "free" | "fixed_price" | "market_auto";

export interface CustomHeaderRule {
  value: string;
  mode: "force" | "fallback";
}

export interface CustomHeadersConfig {
  headers?: Record<string, CustomHeaderRule>;
  passthrough?: boolean;
  /** When "bearer", converts Anthropic x-api-key to Authorization: Bearer for providers that require it (e.g. Kimi). */
  authMode?: "bearer";
}

export interface CandidateOffering {
  offeringId: string;
  ownerUserId: string;
  providerType: "openai" | "anthropic" | "openai_compatible";
  credentialId: string;
  apiKeyEnvName?: string;
  encryptedSecret?: string;
  baseUrl?: string;
  anthropicBaseUrl?: string;
  realModel: string;
  pricingMode: PricingMode;
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  cacheReadDiscount?: number; // 1-100, default 50 (% of input price for cache hits)
  qpsLimit?: number;
  maxContextTokens?: number;
  successRate1h: number;
  p95LatencyMs1h: number;
  recentErrorRate10m: number;
  enabled: boolean;
  executionMode?: 'platform' | 'node';
  nodeId?: string;
  dailyTokenLimit?: number;
  maxConcurrency?: number;
  customHeaders?: CustomHeadersConfig;
  providerLabel?: string;
  compatMode?: string;
  thirdParty?: boolean;
  thirdPartyLabel?: string;
  trustLevel?: 'high' | 'medium' | 'low';
}
