import assert from "node:assert/strict";
import test from "node:test";

import { parseRawUsage, mergeUsage, detectUsageFormat, ZERO_USAGE } from "../core/adapters/usage-parser.js";

// ── Format detection ──────────────────────────────────────────

test("detectUsageFormat: Anthropic cache_read_input_tokens → anthropic", () => {
  assert.equal(detectUsageFormat({ input_tokens: 50, cache_read_input_tokens: 800 }), "anthropic");
});

test("detectUsageFormat: OpenAI prompt_tokens_details → openai", () => {
  assert.equal(detectUsageFormat({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 80 } }), "openai");
});

test("detectUsageFormat: only prompt_tokens → openai", () => {
  assert.equal(detectUsageFormat({ prompt_tokens: 100, completion_tokens: 20 }), "openai");
});

test("detectUsageFormat: only input_tokens (no prompt_tokens) → anthropic", () => {
  assert.equal(detectUsageFormat({ input_tokens: 50, output_tokens: 10 }), "anthropic");
});

test("detectUsageFormat: empty object → openai (default)", () => {
  assert.equal(detectUsageFormat({}), "openai");
});

// ── OpenAI standard (with cache) ─────────────────────────────

test("parseRawUsage: OpenAI with cached_tokens (subset model)", () => {
  const raw = {
    prompt_tokens: 1000,
    completion_tokens: 50,
    total_tokens: 1050,
    prompt_tokens_details: { cached_tokens: 800 },
  };
  const u = parseRawUsage(raw);
  assert.equal(u.inputTokens, 200, "non-cached = 1000 - 800");
  assert.equal(u.cacheReadTokens, 800);
  assert.equal(u.cacheCreationTokens, 0);
  assert.equal(u.outputTokens, 50);
  assert.equal(u.totalTokens, 1050, "200 + 800 + 0 + 50");
});

test("parseRawUsage: OpenAI without cache (no prompt_tokens_details)", () => {
  const raw = { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 };
  const u = parseRawUsage(raw);
  assert.equal(u.inputTokens, 500);
  assert.equal(u.cacheReadTokens, 0);
  assert.equal(u.cacheCreationTokens, 0);
  assert.equal(u.outputTokens, 100);
  assert.equal(u.totalTokens, 600);
});

test("parseRawUsage: OpenAI with cached_tokens=0", () => {
  const raw = {
    prompt_tokens: 300,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 0 },
  };
  const u = parseRawUsage(raw);
  assert.equal(u.inputTokens, 300, "no cache → inputTokens = prompt_tokens");
  assert.equal(u.cacheReadTokens, 0);
  assert.equal(u.totalTokens, 320);
});

// ── Anthropic standard (parallel model) ──────────────────────

test("parseRawUsage: Anthropic with cache read + creation", () => {
  const raw = {
    input_tokens: 50,
    cache_read_input_tokens: 10000,
    cache_creation_input_tokens: 248,
    output_tokens: 503,
  };
  const u = parseRawUsage(raw);
  assert.equal(u.inputTokens, 50, "direct from input_tokens");
  assert.equal(u.cacheReadTokens, 10000);
  assert.equal(u.cacheCreationTokens, 248);
  assert.equal(u.outputTokens, 503);
  assert.equal(u.totalTokens, 10801, "50 + 10000 + 248 + 503");
});

test("parseRawUsage: Anthropic cache read only (no creation)", () => {
  const raw = {
    input_tokens: 100,
    cache_read_input_tokens: 5000,
    cache_creation_input_tokens: 0,
    output_tokens: 200,
  };
  const u = parseRawUsage(raw);
  assert.equal(u.inputTokens, 100);
  assert.equal(u.cacheReadTokens, 5000);
  assert.equal(u.cacheCreationTokens, 0);
  assert.equal(u.totalTokens, 5300);
});

test("parseRawUsage: Anthropic no cache at all", () => {
  const raw = { input_tokens: 100, output_tokens: 50 };
  const u = parseRawUsage(raw);
  assert.equal(u.inputTokens, 100);
  assert.equal(u.cacheReadTokens, 0);
  assert.equal(u.cacheCreationTokens, 0);
  assert.equal(u.totalTokens, 150);
});

// ── Kimi edge case (input_tokens=0, all in cache_read) ───────

test("parseRawUsage: Kimi — input_tokens=0, cache_read=13", () => {
  const raw = {
    input_tokens: 0,
    cache_read_input_tokens: 13,
    cache_creation_input_tokens: 0,
    output_tokens: 4,
  };
  const u = parseRawUsage(raw);
  assert.equal(u.inputTokens, 0, "Kimi reports 0 non-cached input");
  assert.equal(u.cacheReadTokens, 13, "all input is cache read");
  assert.equal(u.cacheCreationTokens, 0);
  assert.equal(u.outputTokens, 4);
  assert.equal(u.totalTokens, 17, "0 + 13 + 0 + 4");
});

// ── Format hint override ─────────────────────────────────────

test("parseRawUsage: format hint forces OpenAI parsing on ambiguous data", () => {
  // This data has both prompt_tokens and cache_read_input_tokens
  // Without hint, would auto-detect as Anthropic
  const raw = { prompt_tokens: 100, cache_read_input_tokens: 80, completion_tokens: 10 };
  const uAnth = parseRawUsage(raw); // auto-detect: anthropic (has cache_read)
  assert.equal(uAnth.inputTokens, 0, "anthropic: input_tokens missing → 0");

  const uOai = parseRawUsage(raw, "openai"); // forced: openai
  assert.equal(uOai.inputTokens, 20, "openai: 100 - 80 = 20");
});

// ── totalTokens always recomputed ────────────────────────────

test("parseRawUsage: ignores upstream total_tokens, recomputes", () => {
  const raw = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 999 };
  const u = parseRawUsage(raw);
  assert.equal(u.totalTokens, 150, "recomputed, not upstream 999");
});

// ── Edge cases ───────────────────────────────────────────────

test("parseRawUsage: all zeros", () => {
  const u = parseRawUsage({});
  assert.deepEqual(u, ZERO_USAGE);
});

test("parseRawUsage: negative inputTokens clamped to 0", () => {
  // Hypothetical: prompt_tokens=5 but cached_tokens=10 (shouldn't happen, but defensive)
  const raw = { prompt_tokens: 5, prompt_tokens_details: { cached_tokens: 10 }, completion_tokens: 1 };
  const u = parseRawUsage(raw);
  assert.equal(u.inputTokens, 0, "clamped to 0, not -5");
  assert.equal(u.cacheReadTokens, 10);
  assert.equal(u.totalTokens, 11, "0 + 10 + 0 + 1");
});

test("parseRawUsage: string values coerced to numbers", () => {
  const raw = { input_tokens: "50", cache_read_input_tokens: "100", output_tokens: "10" } as any;
  const u = parseRawUsage(raw);
  assert.equal(u.inputTokens, 50);
  assert.equal(u.cacheReadTokens, 100);
  assert.equal(u.outputTokens, 10);
});

// ── mergeUsage ───────────────────────────────────────────────

test("mergeUsage: takes max of each field", () => {
  const a = { inputTokens: 100, outputTokens: 0, totalTokens: 100, cacheReadTokens: 50, cacheCreationTokens: 0 };
  const b = { inputTokens: 0, outputTokens: 80, totalTokens: 80, cacheReadTokens: 50, cacheCreationTokens: 10 };
  const m = mergeUsage(a, b);
  assert.equal(m.inputTokens, 100);
  assert.equal(m.outputTokens, 80);
  assert.equal(m.cacheReadTokens, 50);
  assert.equal(m.cacheCreationTokens, 10);
  assert.equal(m.totalTokens, 240, "100 + 50 + 10 + 80");
});

test("mergeUsage: both zero → zero", () => {
  assert.deepEqual(mergeUsage(ZERO_USAGE, ZERO_USAGE), ZERO_USAGE);
});

test("mergeUsage: one side zero → other side", () => {
  const usage = { inputTokens: 42, outputTokens: 18, totalTokens: 60, cacheReadTokens: 0, cacheCreationTokens: 0 };
  assert.deepEqual(mergeUsage(usage, ZERO_USAGE), usage);
  assert.deepEqual(mergeUsage(ZERO_USAGE, usage), usage);
});
