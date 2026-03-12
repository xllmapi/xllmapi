export type RoutingMode =
  | "balanced"
  | "low_cost"
  | "low_latency"
  | "high_reliability";

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
}

export interface CoreChatExecuteRequest {
  requestId: string;
  traceId: string;
  requesterUserId: string;
  logicalModel: string;
  routingMode: RoutingMode;
  stream: boolean;
  requestPayload: {
    messages?: ChatMessage[];
    input?: string | object;
    temperature?: number;
    maxTokens?: number;
  };
  candidateOfferings: CandidateOffering[];
}

export interface CoreChatExecuteResponse {
  requestId: string;
  executionId: string;
  chosenOfferingId: string;
  fallbackUsed: boolean;
  provider: string;
  realModel: string;
  outputText: string;
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

export const exampleRouteExecuteRequest = (): CoreChatExecuteRequest => ({
  requestId: "req_example",
  traceId: "trace_example",
  requesterUserId: "user_example",
  logicalModel: "gpt-4o-mini",
  routingMode: "balanced",
  stream: false,
  requestPayload: {
    messages: [
      {
        role: "user",
        content: "Say hello from xllmapi."
      }
    ],
    temperature: 0.2,
    maxTokens: 128
  },
  candidateOfferings: [
    {
      offeringId: "offering_openai_demo",
      ownerUserId: "supplier_openai_demo",
      providerType: "openai",
      credentialId: "cred_openai_demo",
      apiKeyEnvName: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      realModel: "gpt-4o-mini",
      pricingMode: "fixed_price",
      fixedPricePer1kInput: 1000,
      fixedPricePer1kOutput: 2000,
      successRate1h: 0.99,
      p95LatencyMs1h: 1200,
      recentErrorRate10m: 0.01,
      enabled: true
    }
  ]
});

export const exampleRouteExecuteResponse = (): CoreChatExecuteResponse => ({
  requestId: "req_example",
  executionId: "exec_example",
  chosenOfferingId: "offering_openai_demo",
  fallbackUsed: false,
  provider: "openai",
  realModel: "gpt-4o-mini",
  outputText: "Hello from the core router executor.",
  usage: {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20
  },
  timing: {
    routeMs: 1,
    providerLatencyMs: 120,
    totalMs: 121
  }
});
