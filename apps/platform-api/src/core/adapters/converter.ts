/**
 * Format converters: OpenAI ↔ Anthropic request body conversion.
 * Used when client sends one format but provider only supports the other.
 *
 * Handles: messages, system, tools, tool_choice, images, thinking,
 * and common parameters (temperature, top_p, stop, etc.)
 */
import type { ApiFormatId } from "./types.js";

/* ── Helper types ── */

interface ContentBlock {
  type?: string;
  text?: string;
  // Anthropic image
  source?: { type?: string; media_type?: string; data?: string; url?: string };
  // OpenAI image_url
  image_url?: { url?: string; detail?: string };
  // tool_use
  id?: string;
  name?: string;
  input?: unknown;
  // tool_result
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  // thinking
  thinking?: string;
}

/* ── OpenAI → Anthropic tool conversion ── */

function convertOpenaiToolsToAnthropic(tools: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return tools.map(t => {
    const fn = t.function as Record<string, unknown> | undefined;
    if (t.type === "function" && fn) {
      return {
        name: fn.name,
        description: fn.description,
        input_schema: fn.parameters ?? { type: "object", properties: {} },
      };
    }
    return t; // pass through non-function tools
  });
}

function convertOpenaiToolChoice(choice: unknown): unknown {
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "any" }; // closest Anthropic equiv
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object" && choice !== null) {
    const c = choice as Record<string, unknown>;
    const fn = c.function as Record<string, unknown> | undefined;
    if (fn?.name) return { type: "tool", name: fn.name };
  }
  return choice;
}

/* ── Content block conversion helpers ── */

function convertOpenaiContentToAnthropic(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;

  return (content as ContentBlock[]).map(block => {
    if (block.type === "image_url" && block.image_url?.url) {
      const url = block.image_url.url;
      // Data URL: data:image/png;base64,...
      const dataMatch = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (dataMatch) {
        return {
          type: "image",
          source: { type: "base64", media_type: dataMatch[1], data: dataMatch[2] },
        };
      }
      // Regular URL
      return {
        type: "image",
        source: { type: "url", url },
      };
    }
    return block; // text blocks pass through
  });
}

function convertAnthropicContentToOpenai(content: unknown): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);

  const blocks = content as ContentBlock[];
  // If all blocks are text, join into string
  if (blocks.every(b => b.type === "text" || !b.type)) {
    return blocks.map(b => b.text ?? "").join("\n");
  }

  // Mixed content: convert block by block
  return blocks.map(block => {
    if (block.type === "text") return { type: "text", text: block.text ?? "" };
    if (block.type === "image" && block.source) {
      if (block.source.type === "base64" && block.source.data) {
        return {
          type: "image_url",
          image_url: { url: `data:${block.source.media_type ?? "image/png"};base64,${block.source.data}` },
        };
      }
      if (block.source.url) {
        return { type: "image_url", image_url: { url: block.source.url } };
      }
    }
    if (block.type === "tool_use") {
      // Will be handled at message level, but include as text fallback
      return { type: "text", text: `[tool_use: ${block.name}]` };
    }
    if (block.type === "tool_result") {
      return { type: "text", text: typeof block.content === "string" ? block.content : JSON.stringify(block.content) };
    }
    // Unknown block: serialize as text
    return { type: "text", text: JSON.stringify(block) };
  });
}

/**
 * Convert OpenAI chat completions request body to Anthropic messages format.
 */
function openaiToAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages ?? []) as Array<{ role: string; content: unknown; tool_call_id?: string; name?: string }>;

  // Extract system message (OpenAI puts it in messages, Anthropic uses top-level 'system')
  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystemMessages = messages.filter(m => m.role !== "system");

  const systemText = systemMessages
    .map(m => typeof m.content === "string" ? m.content : "")
    .filter(Boolean)
    .join("\n");

  // Convert messages to Anthropic format
  const anthropicMessages: Array<Record<string, unknown>> = [];
  for (const m of nonSystemMessages) {
    if (m.role === "tool") {
      // OpenAI tool message → Anthropic tool_result in user message
      anthropicMessages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.tool_call_id ?? "",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }],
      });
    } else {
      anthropicMessages.push({
        role: m.role === "assistant" ? "assistant" : "user",
        content: convertOpenaiContentToAnthropic(m.content),
      });
    }
  }

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
  // Preserve thinking/reasoning fields for providers that support extended thinking
  if (body.thinking !== undefined) result.thinking = body.thinking;

  // Tools conversion
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    result.tools = convertOpenaiToolsToAnthropic(body.tools as Array<Record<string, unknown>>);
  }
  if (body.tool_choice !== undefined) {
    result.tool_choice = convertOpenaiToolChoice(body.tool_choice);
  }

  // Pass through additional parameters
  if (body.top_k !== undefined) result.top_k = body.top_k;
  if (body.metadata !== undefined) result.metadata = body.metadata;

  return result;
}

/**
 * Convert Anthropic messages request body to OpenAI chat completions format.
 */
function anthropicToOpenai(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages ?? []) as Array<{ role: string; content: unknown }>;

  // Build OpenAI messages array
  const openaiMessages: Array<Record<string, unknown>> = [];

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
    if (Array.isArray(m.content)) {
      const blocks = m.content as ContentBlock[];

      // Check if any block is tool_result → convert to tool messages
      const toolResults = blocks.filter(b => b.type === "tool_result");
      const otherBlocks = blocks.filter(b => b.type !== "tool_result");

      // Convert non-tool-result content
      if (otherBlocks.length > 0) {
        const content = convertAnthropicContentToOpenai(otherBlocks);

        // Extract tool_use blocks as tool_calls on assistant message
        const toolUseBlocks = otherBlocks.filter(b => b.type === "tool_use");
        if (m.role === "assistant" && toolUseBlocks.length > 0) {
          const toolCalls = toolUseBlocks.map(b => ({
            id: b.id ?? `call_${Date.now()}`,
            type: "function",
            function: {
              name: b.name ?? "",
              arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input ?? {}),
            },
          }));
          const textContent = otherBlocks.filter(b => b.type === "text").map(b => b.text ?? "").join("");
          openaiMessages.push({
            role: "assistant",
            content: textContent || null,
            tool_calls: toolCalls,
          });
        } else {
          openaiMessages.push({ role: m.role, content });
        }
      }

      // Convert tool_result blocks to separate tool messages
      for (const tr of toolResults) {
        openaiMessages.push({
          role: "tool",
          tool_call_id: tr.tool_use_id ?? "",
          content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content ?? ""),
        });
      }
    } else {
      // Simple string content
      openaiMessages.push({
        role: m.role,
        content: typeof m.content === "string" ? m.content : String(m.content),
      });
    }
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
  // Preserve thinking/reasoning fields for providers that support extended thinking
  if (body.thinking !== undefined) result.thinking = body.thinking;

  // Tools conversion: Anthropic → OpenAI
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    result.tools = (body.tools as Array<Record<string, unknown>>).map(t => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema ?? { type: "object", properties: {} },
      },
    }));
  }
  if (body.tool_choice !== undefined) {
    const tc = body.tool_choice as Record<string, unknown>;
    if (tc.type === "auto") result.tool_choice = "auto";
    else if (tc.type === "any") result.tool_choice = "required";
    else if (tc.type === "tool" && tc.name) result.tool_choice = { type: "function", function: { name: tc.name } };
    else result.tool_choice = body.tool_choice;
  }

  // Pass through additional parameters
  if (body.presence_penalty !== undefined) result.presence_penalty = body.presence_penalty;
  if (body.frequency_penalty !== undefined) result.frequency_penalty = body.frequency_penalty;
  if (body.seed !== undefined) result.seed = body.seed;
  if (body.response_format !== undefined) result.response_format = body.response_format;

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
