import type { ChatMessage } from "@xllmapi/shared-types";
import { parseSseStream } from "./sse-parser.js";
import { isRetryableStatus } from "../resilience/retry.js";
import { estimateTokens } from "../context/context-manager.js";

export interface StreamResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
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
  tools?: unknown[];
  toolChoice?: unknown;
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onRawChunk?: (parsed: Record<string, unknown>) => void;
}): Promise<StreamResult> {
  const base = params.baseUrl.replace(/\/+$/, "");
  const url = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(params.extraBody ?? {})
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = Math.min(params.maxTokens, 8192);
  if (params.tools && params.tools.length > 0) body.tools = params.tools;
  if (params.toolChoice !== undefined) body.tool_choice = params.toolChoice;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.apiKey}`,
      "user-agent": "claude-code/1.0",
      ...params.extraHeaders,
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
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  let finishReason = "stop";
  let inThinking = false;

  for await (const event of parseSseStream(response.body, params.signal)) {
    if (event.data === "[DONE]") break;

    try {
      const payload = JSON.parse(event.data);

      const contentDelta = payload?.choices?.[0]?.delta?.content;
      const reasoningDelta = payload?.choices?.[0]?.delta?.reasoning_content;

      // Normalize: wrap reasoning_content in <think> tags
      if (typeof reasoningDelta === "string" && reasoningDelta) {
        if (!inThinking) { inThinking = true; content += "<think>"; params.onDelta("<think>"); }
        content += reasoningDelta;
        params.onDelta(reasoningDelta);
      }
      if (typeof contentDelta === "string" && contentDelta) {
        if (inThinking) { inThinking = false; content += "</think>"; params.onDelta("</think>"); }
        content += contentDelta;
        params.onDelta(contentDelta);
      }

      // Extract finish reason
      const fr = payload?.choices?.[0]?.finish_reason;
      if (fr) finishReason = fr;

      // Extract usage (typically in the last chunk when stream_options.include_usage is set)
      if (payload?.usage) {
        const u = payload.usage;
        const cacheRead = Number(u.cache_read_input_tokens ?? 0) || Number(u.prompt_tokens_details?.cached_tokens ?? 0);
        const cacheCreation = Number(u.cache_creation_input_tokens ?? 0);
        const rawInput = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
        const inputTokens = (rawInput >= cacheRead && cacheRead > 0) ? rawInput - cacheRead : rawInput || (cacheRead + cacheCreation);
        const outputTokens = u.completion_tokens ?? u.output_tokens ?? 0;
        usage = {
          inputTokens,
          outputTokens,
          totalTokens: u.total_tokens ?? (inputTokens + cacheRead + cacheCreation + outputTokens),
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
        };
      }
    } catch {
      // Non-JSON data line, skip
    }
  }

  // Close thinking tag if still open
  if (inThinking) { content += "</think>"; params.onDelta("</think>"); }

  // If usage wasn't provided via stream, estimate from content
  if (usage.totalTokens === 0 && content.length > 0) {
    usage.outputTokens = estimateTokens(content);
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
  extraHeaders?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<StreamResult> {
  const base2 = params.baseUrl.replace(/\/+$/, "");
  const url2 = base2.endsWith("/v1") ? `${base2}/chat/completions` : `${base2}/v1/chat/completions`;

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: false
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = Math.min(params.maxTokens, 8192);

  const response = await fetch(url2, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.apiKey}`,
      "user-agent": "claude-code/1.0",
      ...params.extraHeaders,
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
  const u = result.usage as Record<string, unknown> | undefined;
  const cacheRead = u ? (Number(u.cache_read_input_tokens ?? 0) || Number((u.prompt_tokens_details as Record<string, unknown>)?.cached_tokens ?? 0)) : 0;
  const cacheCreation = u ? Number(u.cache_creation_input_tokens ?? 0) : 0;
  const rawInput = u ? Number(u.prompt_tokens ?? u.input_tokens ?? 0) : 0;
  const inputTokens = (rawInput >= cacheRead && cacheRead > 0) ? rawInput - cacheRead : rawInput || (cacheRead + cacheCreation);
  const outputTokens = u ? Number(u.completion_tokens ?? u.output_tokens ?? 0) : 0;
  const usage = {
    inputTokens,
    outputTokens,
    totalTokens: u ? Number(u.total_tokens ?? 0) || (inputTokens + cacheRead + cacheCreation + outputTokens) : 0,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
  };

  return { content, usage, finishReason };
}
