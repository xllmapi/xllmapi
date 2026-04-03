/**
 * Unified usage parser — single source of truth for extracting token usage
 * from any upstream API response's raw usage object.
 *
 * Handles the fundamental format difference:
 *   OpenAI:    prompt_tokens INCLUDES cached (subset relationship)
 *   Anthropic: input_tokens EXCLUDES cached (parallel relationship)
 */

export interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Safely coerce to number, defaulting to 0 */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Auto-detect whether raw usage object is OpenAI or Anthropic format */
export function detectUsageFormat(raw: Record<string, unknown>): "openai" | "anthropic" {
  if (raw.cache_read_input_tokens !== undefined) return "anthropic";
  if (raw.input_tokens !== undefined && raw.prompt_tokens === undefined) return "anthropic";
  if (raw.prompt_tokens_details !== undefined) return "openai";
  if (raw.prompt_tokens !== undefined) return "openai";
  return "openai";
}

/**
 * Parse a raw usage object into ParsedUsage.
 * This is the ONLY function that understands the relationship between
 * input tokens and cache tokens across different API formats.
 */
export function parseRawUsage(
  raw: Record<string, unknown>,
  formatHint?: "openai" | "anthropic",
): ParsedUsage {
  const format = formatHint ?? detectUsageFormat(raw);

  const cacheRead = num(raw.cache_read_input_tokens)
    || num((raw.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
  const cacheCreation = num(raw.cache_creation_input_tokens);
  const outputTokens = num(raw.completion_tokens ?? raw.output_tokens);

  let inputTokens: number;
  if (format === "openai") {
    const promptTokens = num(raw.prompt_tokens);
    inputTokens = cacheRead > 0 ? Math.max(0, promptTokens - cacheRead) : promptTokens;
  } else {
    inputTokens = num(raw.input_tokens);
  }

  const totalTokens = inputTokens + cacheRead + cacheCreation + outputTokens;
  return { inputTokens, outputTokens, totalTokens, cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreation };
}

/** Merge two usage values by taking the max of each field, recomputing total. */
export function mergeUsage(a: ParsedUsage, b: ParsedUsage): ParsedUsage {
  const merged = {
    inputTokens: Math.max(a.inputTokens, b.inputTokens),
    outputTokens: Math.max(a.outputTokens, b.outputTokens),
    cacheReadTokens: Math.max(a.cacheReadTokens, b.cacheReadTokens),
    cacheCreationTokens: Math.max(a.cacheCreationTokens, b.cacheCreationTokens),
    totalTokens: 0,
  };
  merged.totalTokens = merged.inputTokens + merged.cacheReadTokens + merged.cacheCreationTokens + merged.outputTokens;
  return merged;
}

export const ZERO_USAGE: ParsedUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
