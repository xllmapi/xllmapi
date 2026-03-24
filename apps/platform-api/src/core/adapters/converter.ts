/**
 * Format converters: OpenAI ↔ Anthropic request body conversion.
 * Used when client sends one format but provider only supports the other.
 */
import type { ApiFormatId } from "./types.js";

/**
 * Convert OpenAI chat completions request body to Anthropic messages format.
 */
function openaiToAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages ?? []) as Array<{ role: string; content: unknown }>;

  // Extract system message (OpenAI puts it in messages, Anthropic uses top-level 'system')
  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystemMessages = messages.filter(m => m.role !== "system");

  const systemText = systemMessages
    .map(m => typeof m.content === "string" ? m.content : "")
    .filter(Boolean)
    .join("\n");

  // Convert messages to Anthropic format
  const anthropicMessages = nonSystemMessages.map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string"
      ? m.content
      : m.content, // Pass through content blocks as-is
  }));

  const result: Record<string, unknown> = {
    model: body.model,
    messages: anthropicMessages,
    max_tokens: body.max_tokens ?? 4096,
  };

  if (systemText) result.system = systemText;
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.stream !== undefined) result.stream = body.stream;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.stop !== undefined) result.stop_sequences = body.stop;

  return result;
}

/**
 * Convert Anthropic messages request body to OpenAI chat completions format.
 */
function anthropicToOpenai(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages ?? []) as Array<{ role: string; content: unknown }>;

  // Build OpenAI messages array
  const openaiMessages: Array<{ role: string; content: string }> = [];

  // Add system message if present
  if (body.system) {
    const systemContent = typeof body.system === "string"
      ? body.system
      : Array.isArray(body.system)
        ? (body.system as Array<{ text?: string }>).map(b => b.text ?? "").join("\n")
        : "";
    if (systemContent) {
      openaiMessages.push({ role: "system", content: systemContent });
    }
  }

  // Convert messages
  for (const m of messages) {
    const content = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? (m.content as Array<{ type?: string; text?: string }>)
            .filter(b => b.type === "text")
            .map(b => b.text ?? "")
            .join("\n")
        : String(m.content);
    openaiMessages.push({ role: m.role, content });
  }

  const result: Record<string, unknown> = {
    model: body.model,
    messages: openaiMessages,
  };

  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.stream !== undefined) result.stream = body.stream;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.stop_sequences !== undefined) result.stop = body.stop_sequences;

  return result;
}

/**
 * Convert request body from one format to another.
 * Returns the body unchanged if formats are the same.
 */
export function convertRequestBody(
  from: ApiFormatId,
  to: ApiFormatId,
  body: Record<string, unknown>
): Record<string, unknown> {
  if (from === to) return body;
  if (from === "openai" && to === "anthropic") return openaiToAnthropic(body);
  if (from === "anthropic" && to === "openai") return anthropicToOpenai(body);
  throw new Error(`No converter available: ${from} → ${to}`);
}
