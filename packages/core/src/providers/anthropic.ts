import type { ChatMessage } from "@xllmapi/shared-types";
import { parseSseStream } from "./sse-parser.js";
import { isRetryableStatus } from "../resilience/retry.js";

export interface StreamResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string;
}

/**
 * Anthropic Claude streaming provider.
 * SSE events: message_start -> content_block_start -> content_block_delta -> content_block_stop -> message_delta -> message_stop
 */
export async function streamAnthropic(params: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<StreamResult> {
  // Separate system message from conversation messages
  const systemMessages = params.messages.filter((m) => m.role === "system");
  const conversationMessages = params.messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: params.model,
    messages: conversationMessages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: params.maxTokens ?? 4096,
    stream: true
  };
  if (systemMessages.length > 0) {
    body.system = systemMessages.map((m) => m.content).join("\n\n");
  }
  if (params.temperature !== undefined) body.temperature = params.temperature;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body),
    signal: params.signal
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => "");
    if (isRetryableStatus(response.status)) {
      throw new TypeError(`anthropic returned ${response.status}: ${errorText}`);
    }
    throw new Error(`anthropic returned ${response.status}: ${errorText}`);
  }

  let content = "";
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let finishReason = "end_turn";

  for await (const event of parseSseStream(response.body, params.signal)) {
    try {
      const payload = JSON.parse(event.data);

      switch (event.event) {
        case "message_start": {
          // Extract input token count from message_start
          if (payload?.message?.usage?.input_tokens) {
            usage.inputTokens = payload.message.usage.input_tokens;
          }
          break;
        }
        case "content_block_delta": {
          const delta = payload?.delta?.text;
          if (typeof delta === "string") {
            content += delta;
            params.onDelta(delta);
          }
          break;
        }
        case "message_delta": {
          // Extract output token count and stop reason
          if (payload?.usage?.output_tokens) {
            usage.outputTokens = payload.usage.output_tokens;
          }
          if (payload?.delta?.stop_reason) {
            finishReason = payload.delta.stop_reason;
          }
          break;
        }
        // content_block_start, content_block_stop, message_stop: no action needed
      }
    } catch {
      // Non-JSON data, skip
    }
  }

  usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return { content, usage, finishReason };
}

/**
 * Anthropic Claude non-streaming provider.
 */
export async function callAnthropic(params: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<StreamResult> {
  const systemMessages = params.messages.filter((m) => m.role === "system");
  const conversationMessages = params.messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: params.model,
    messages: conversationMessages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: params.maxTokens ?? 4096
  };
  if (systemMessages.length > 0) {
    body.system = systemMessages.map((m) => m.content).join("\n\n");
  }
  if (params.temperature !== undefined) body.temperature = params.temperature;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body),
    signal: params.signal
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (isRetryableStatus(response.status)) {
      throw new TypeError(`anthropic returned ${response.status}: ${errorText}`);
    }
    throw new Error(`anthropic returned ${response.status}: ${errorText}`);
  }

  const result = await response.json() as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
    stop_reason?: string;
  };

  const content = result.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("") ?? "";
  const finishReason = result.stop_reason ?? "end_turn";
  const usage = {
    inputTokens: result.usage?.input_tokens ?? 0,
    outputTokens: result.usage?.output_tokens ?? 0,
    totalTokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0)
  };

  return { content, usage, finishReason };
}
