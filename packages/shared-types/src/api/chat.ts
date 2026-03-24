export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
