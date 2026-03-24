import type { PricingMode } from './offerings.js';

export interface PublicMarketModel {
  logicalModel: string;
  providers: string[];
  providerCount: number;
  ownerCount: number;
  enabledOfferingCount: number;
  credentialCount: number;
  pricingModes: PricingMode[];
  minInputPrice: number | null;
  minOutputPrice: number | null;
  status: "available" | "limited";
  capabilities: string[];
  compatibilities: Array<"openai" | "anthropic">;
  featuredSuppliers: Array<{
    handle: string;
    displayName: string;
  }>;
}

export interface PublicSupplierProfile {
  handle: string;
  displayName: string;
  status: "active" | "inactive";
  activeOfferingCount: number;
  servedUserCount: number;
  totalRequestCount: number;
  totalSupplyTokens: number;
  totalStableSeconds: number;
  lastActiveAt: string | null;
}

export interface PublicSupplierOffering {
  id: string;
  logicalModel: string;
  realModel: string;
  providerType: "openai_compatible" | "anthropic" | "openai";
  compatibilities: Array<"openai" | "anthropic">;
  inputPricePer1k: number;
  outputPricePer1k: number;
  servedUserCount: number;
  requestCount: number;
  totalSupplyTokens: number;
  stableSeconds: number;
  enabled: boolean;
}
