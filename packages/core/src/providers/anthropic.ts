import type { ChatMessage } from "@xllmapi/shared-types";
import { parseSseStream } from "./sse-parser.js";
import { isRetryableStatus } from "../resilience/retry.js";
import { parseRawUsage, mergeUsage, ZERO_USAGE } from "../usage-parser.js";

export interface StreamResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
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
  extraHeaders?: Record<string, string>;
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
      "anthropic-version": "2023-06-01",
      ...params.extraHeaders,
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
  let usage = { ...ZERO_USAGE };
  let finishReason = "end_turn";

  for await (const event of parseSseStream(response.body, params.signal)) {
    try {
      const payload = JSON.parse(event.data);

      switch (event.event) {
        case "message_start": {
          if (payload?.message?.usage) {
            usage = mergeUsage(usage, parseRawUsage(payload.message.usage as Record<string, unknown>, "anthropic"));
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
          if (payload?.usage) {
            usage = mergeUsage(usage, parseRawUsage(payload.usage as Record<string, unknown>, "anthropic"));
          }
          if (payload?.delta?.stop_reason) {
            finishReason = payload.delta.stop_reason;
          }
          break;
        }
      }
    } catch {
      // Non-JSON data, skip
    }
  }
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
  extraHeaders?: Record<string, string>;
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
      "anthropic-version": "2023-06-01",
      ...params.extraHeaders,
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
  const usage = result.usage
    ? parseRawUsage(result.usage as Record<string, unknown>, "anthropic")
    : { ...ZERO_USAGE };

  return { content, usage, finishReason };
}
