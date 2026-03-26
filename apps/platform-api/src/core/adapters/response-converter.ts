/**
 * Response converters: OpenAI ↔ Anthropic response format conversion.
 * Used when clientFormat ≠ targetFormat so the client can parse the response.
 */
import type { ApiFormatId } from "./types.js";

/* ── Stop reason mapping ── */

function mapStopReasonToAnthropic(finishReason: string | null | undefined): string | null {
  if (!finishReason) return null;
  switch (finishReason) {
    case "stop": return "end_turn";
    case "length": return "max_tokens";
    case "content_filter": return "end_turn";
    default: return "end_turn";
  }
}

function mapStopReasonToOpenai(stopReason: string | null | undefined): string | null {
  if (!stopReason) return null;
  switch (stopReason) {
    case "end_turn": return "stop";
    case "max_tokens": return "length";
    case "stop_sequence": return "stop";
    default: return "stop";
  }
}

/* ── Non-streaming JSON conversion ── */

function openaiJsonToAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const choices = (body.choices ?? []) as Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  const choice = choices[0];
  const content = choice?.message?.content ?? "";
  const usage = (body.usage ?? {}) as Record<string, number>;

  return {
    id: body.id ?? `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: body.model ?? "unknown",
    content: [{ type: "text", text: content }],
    stop_reason: mapStopReasonToAnthropic(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}

function anthropicJsonToOpenai(body: Record<string, unknown>): Record<string, unknown> {
  const contentBlocks = (body.content ?? []) as Array<{ type?: string; text?: string }>;
  const textContent = contentBlocks
    .filter(b => b.type === "text")
    .map(b => b.text ?? "")
    .join("");
  const usage = (body.usage ?? {}) as Record<string, number>;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;

  return {
    id: body.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "unknown",
    choices: [{
      index: 0,
      message: {
        role: (body.role as string) ?? "assistant",
        content: textContent,
      },
      finish_reason: mapStopReasonToOpenai(body.stop_reason as string | null),
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

/**
 * Convert a non-streaming JSON response body from one API format to another.
 * Returns the body unchanged if formats are the same.
 */
export function convertJsonResponse(
  from: ApiFormatId,
  to: ApiFormatId,
  body: Record<string, unknown>
): Record<string, unknown> {
  if (from === to) return body;
  if (from === "openai" && to === "anthropic") return openaiJsonToAnthropic(body);
  if (from === "anthropic" && to === "openai") return anthropicJsonToOpenai(body);
  throw new Error(`No response converter available: ${from} → ${to}`);
}

/* ── Streaming SSE conversion ── */

interface StreamConverter {
  /** Process an incoming chunk of SSE text. Returns complete SSE lines to emit. */
  transform(chunk: string): string[];
  /** Flush any remaining state at end of stream. Returns final SSE lines to emit. */
  flush(): string[];
}

function createOpenaiToAnthropicStreamConverter(): StreamConverter {
  let state: "init" | "streaming" | "done" = "init";
  let buffer = "";
  let messageId = `msg_${Date.now()}`;
  let model = "unknown";
  let outputTokens = 0;

  function formatEvent(eventType: string, data: Record<string, unknown>): string {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function processLine(line: string): string[] {
    const results: string[] = [];

    if (line === "data: [DONE]") {
      if (state !== "done") {
        results.push(...emitClosingEvents());
      }
      return results;
    }

    if (!line.startsWith("data: ")) return results;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr) return results;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return results;
    }

    if (parsed.id) messageId = String(parsed.id);
    if (parsed.model) model = String(parsed.model);

    // Extract usage if present
    const usageObj = parsed.usage as Record<string, number> | undefined;
    if (usageObj?.completion_tokens) {
      outputTokens = usageObj.completion_tokens;
    }

    const choices = (parsed.choices ?? []) as Array<{
      delta?: { role?: string; content?: string };
      finish_reason?: string | null;
    }>;
    const choice = choices[0];
    if (!choice) return results;

    const delta = choice.delta ?? {};
    const finishReason = choice.finish_reason;

    if (state === "init" && (delta.content !== undefined || delta.role !== undefined)) {
      // Emit message_start + content_block_start
      results.push(formatEvent("message_start", {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));
      results.push(formatEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }));
      state = "streaming";
    }

    if (state === "streaming" && delta.content) {
      results.push(formatEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: delta.content },
      }));
    }

    if (finishReason && state !== "done") {
      results.push(...emitClosingEvents(finishReason));
    }

    return results;
  }

  function emitClosingEvents(finishReason?: string): string[] {
    state = "done";
    const results: string[] = [];

    // If we never started streaming, emit the start events first
    results.push(formatEvent("content_block_stop", {
      type: "content_block_stop",
      index: 0,
    }));
    results.push(formatEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: mapStopReasonToAnthropic(finishReason ?? "stop") },
      usage: { output_tokens: outputTokens },
    }));
    results.push(formatEvent("message_stop", {
      type: "message_stop",
    }));
    return results;
  }

  return {
    transform(chunk: string): string[] {
      buffer += chunk;
      const results: string[] = [];
      const lines = buffer.split("\n");
      // Keep last potentially incomplete line in buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        results.push(...processLine(trimmed));
      }
      return results;
    },
    flush(): string[] {
      const results: string[] = [];
      if (buffer.trim()) {
        results.push(...processLine(buffer.trim()));
        buffer = "";
      }
      if (state !== "done") {
        results.push(...emitClosingEvents());
      }
      return results;
    },
  };
}

function createAnthropicToOpenaiStreamConverter(): StreamConverter {
  let buffer = "";
  let currentEvent = "";
  let messageId = `chatcmpl-${Date.now()}`;
  let model = "unknown";
  let done = false;

  function formatOpenaiChunk(data: Record<string, unknown>): string {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  function processEventData(eventType: string, jsonStr: string): string[] {
    const results: string[] = [];

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return results;
    }

    switch (eventType) {
      case "message_start": {
        const message = parsed.message as Record<string, unknown> | undefined;
        if (message) {
          if (message.id) messageId = String(message.id);
          if (message.model) model = String(message.model);
        }
        // Emit first chunk with role
        results.push(formatOpenaiChunk({
          id: messageId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        }));
        break;
      }
      case "content_block_delta": {
        const delta = parsed.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === "text_delta" && delta.text) {
          results.push(formatOpenaiChunk({
            id: messageId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
          }));
        }
        break;
      }
      case "message_delta": {
        const msgDelta = parsed.delta as { stop_reason?: string } | undefined;
        if (msgDelta?.stop_reason) {
          results.push(formatOpenaiChunk({
            id: messageId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: {}, finish_reason: mapStopReasonToOpenai(msgDelta.stop_reason) }],
          }));
        }
        break;
      }
      case "message_stop": {
        if (!done) {
          done = true;
          results.push("data: [DONE]\n\n");
        }
        break;
      }
      // content_block_start, content_block_stop, ping: no output needed
    }

    return results;
  }

  return {
    transform(chunk: string): string[] {
      buffer += chunk;
      const results: string[] = [];
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("event: ")) {
          currentEvent = trimmed.slice(7).trim();
        } else if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6).trim();
          if (currentEvent && jsonStr) {
            results.push(...processEventData(currentEvent, jsonStr));
          }
          currentEvent = "";
        }
      }
      return results;
    },
    flush(): string[] {
      const results: string[] = [];
      if (buffer.trim()) {
        const lines = buffer.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7).trim();
          } else if (trimmed.startsWith("data: ")) {
            const jsonStr = trimmed.slice(6).trim();
            if (currentEvent && jsonStr) {
              results.push(...processEventData(currentEvent, jsonStr));
            }
            currentEvent = "";
          }
        }
        buffer = "";
      }
      if (!done) {
        done = true;
        results.push("data: [DONE]\n\n");
      }
      return results;
    },
  };
}

/**
 * Create a streaming SSE converter that transforms chunks from one format to another.
 * Returns a stateful converter with transform() and flush() methods.
 */
export function createStreamConverter(from: ApiFormatId, to: ApiFormatId): StreamConverter {
  if (from === to) {
    // Identity converter — pass through
    return { transform: (chunk) => [chunk], flush: () => [] };
  }
  if (from === "openai" && to === "anthropic") return createOpenaiToAnthropicStreamConverter();
  if (from === "anthropic" && to === "openai") return createAnthropicToOpenaiStreamConverter();
  throw new Error(`No stream converter available: ${from} → ${to}`);
}
