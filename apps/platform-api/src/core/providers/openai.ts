import type { ChatMessage } from "@xllmapi/shared-types";
import { parseSseStream } from "../sse-parser.js";
import { isRetryableStatus } from "../retry.js";

export interface StreamResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string;
}

/**
 * OpenAI-compatible streaming provider.
 * Works with OpenAI, DeepSeek, Groq, Together, and any OpenAI-compatible API.
 */
export async function streamOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<StreamResult> {
  const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: true,
    stream_options: { include_usage: true }
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify(body),
    signal: params.signal
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => "");
    if (isRetryableStatus(response.status)) {
      throw new TypeError(`provider returned ${response.status}: ${errorText}`);
    }
    throw new Error(`provider returned ${response.status}: ${errorText}`);
  }

  let content = "";
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let finishReason = "stop";

  for await (const event of parseSseStream(response.body, params.signal)) {
    if (event.data === "[DONE]") break;

    try {
      const payload = JSON.parse(event.data);

      // Extract delta content
      const delta = payload?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") {
        content += delta;
        params.onDelta(delta);
      }

      // Extract finish reason
      const fr = payload?.choices?.[0]?.finish_reason;
      if (fr) finishReason = fr;

      // Extract usage (typically in the last chunk when stream_options.include_usage is set)
      if (payload?.usage) {
        usage = {
          inputTokens: payload.usage.prompt_tokens ?? 0,
          outputTokens: payload.usage.completion_tokens ?? 0,
          totalTokens: payload.usage.total_tokens ?? 0
        };
      }
    } catch {
      // Non-JSON data line, skip
    }
  }

  // If usage wasn't provided via stream, estimate from content
  if (usage.totalTokens === 0 && content.length > 0) {
    usage.outputTokens = Math.ceil(content.length / 4);
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
  }

  return { content, usage, finishReason };
}

/**
 * OpenAI-compatible non-streaming provider.
 */
export async function callOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<StreamResult> {
  const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: false
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify(body),
    signal: params.signal
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (isRetryableStatus(response.status)) {
      throw new TypeError(`provider returned ${response.status}: ${errorText}`);
    }
    throw new Error(`provider returned ${response.status}: ${errorText}`);
  }

  const result = await response.json() as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const content = result.choices?.[0]?.message?.content ?? "";
  const finishReason = result.choices?.[0]?.finish_reason ?? "stop";
  const usage = {
    inputTokens: result.usage?.prompt_tokens ?? 0,
    outputTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0
  };

  return { content, usage, finishReason };
}
