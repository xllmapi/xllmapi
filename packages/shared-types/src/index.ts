export type PricingMode = "free" | "fixed_price" | "market_auto";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CandidateOffering {
  offeringId: string;
  ownerUserId: string;
  providerType: "openai" | "anthropic" | "openai_compatible";
  credentialId: string;
  apiKeyEnvName?: string;
  encryptedSecret?: string;
  baseUrl?: string;
  realModel: string;
  pricingMode: PricingMode;
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
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
}

export interface StreamCompletedEvent {
  requestId: string;
  executionId: string;
  chosenOfferingId: string;
  fallbackUsed: boolean;
  provider: string;
  realModel: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  timing: {
    routeMs: number;
    providerLatencyMs: number;
    totalMs: number;
  };
}

export interface PublicChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface PublicChatCompletionsResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: "stop";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  route: {
    offering_id: string;
    provider: string;
    real_model: string;
    fallback_used: boolean;
  };
}

export interface LogicalModel {
  id: string;
  name: string;
  capabilityType: "chat";
  status: "active" | "disabled";
  summary?: {
    offeringCount: number;
    enabledOfferingCount: number;
    ownerCount: number;
    owners: string[];
    providers: string[];
    minInputPricePer1k: number;
    minOutputPricePer1k: number;
    pricingModes: PricingMode[];
    enabled: boolean;
  };
}

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

export interface MeProfile {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  role: "user" | "admin";
  inviteStatus: "active";
  avatarUrl?: string | null;
  phone?: string | null;
  hasPassword?: boolean;
}

export interface InvitationStats {
  limit: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
}

export const listLogicalModels = (): LogicalModel[] => [
  {
    id: "lm_openai_fast",
    name: "gpt-4o-mini",
    capabilityType: "chat",
    status: "active"
  },
  {
    id: "lm_claude_smart",
    name: "claude-sonnet-4-20250514",
    capabilityType: "chat",
    status: "active"
  },
  {
    id: "lm_deepseek_chat",
    name: "deepseek-chat",
    capabilityType: "chat",
    status: "active"
  }
];

// ── Node protocol types ──────────────────────────────────────────────

export interface NodeCapability {
  realModel: string;
  providerType: string;
  maxConcurrency?: number;
  baseUrl?: string;
}

export type NodeMessageType =
  | 'auth' | 'auth.ok' | 'auth.error'
  | 'ping' | 'pong'
  | 'capabilities'
  | 'request'
  | 'response.delta' | 'response.done' | 'response.error';

export interface NodeAuthMessage { type: 'auth'; token: string; protocolVersion: number }
export interface NodeAuthOkMessage { type: 'auth.ok'; nodeId: string }
export interface NodeAuthErrorMessage { type: 'auth.error'; message: string }
export interface NodePingMessage { type: 'ping' }
export interface NodePongMessage { type: 'pong'; uptime: number; activeRequests: number; load: number }
export interface NodeCapabilitiesMessage { type: 'capabilities'; models: NodeCapability[] }
export interface NodeRequestMessage { type: 'request'; requestId: string; payload: { model: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number; stream?: boolean } }
export interface NodeResponseDeltaMessage { type: 'response.delta'; requestId: string; delta: string }
export interface NodeResponseDoneMessage { type: 'response.done'; requestId: string; content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; finishReason: string }
export interface NodeResponseErrorMessage { type: 'response.error'; requestId: string; error: { code: string; message: string } }

export type NodeMessage =
  | NodeAuthMessage | NodeAuthOkMessage | NodeAuthErrorMessage
  | NodePingMessage | NodePongMessage
  | NodeCapabilitiesMessage
  | NodeRequestMessage
  | NodeResponseDeltaMessage | NodeResponseDoneMessage | NodeResponseErrorMessage;

// Node protocol constants
export const NODE_PROTOCOL_VERSION = 1;
export const NODE_HEARTBEAT_INTERVAL_MS = 30_000;
export const NODE_HEARTBEAT_TIMEOUT_MS = 10_000;
export const NODE_REQUEST_TIMEOUT_MS = 120_000;
