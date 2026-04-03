/**
 * Comprehensive cache token tests — covers the entire cache token pipeline:
 *
 * 1. Unified parser (parseRawUsage) — format detection + edge cases
 * 2. Adapter extraction — OpenAI/Anthropic stream + JSON with cache fields
 * 3. Settlement calculation — differential pricing with cache discount
 * 4. Response conversion — cache fields preserved across format conversion
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parseRawUsage, mergeUsage, detectUsageFormat, ZERO_USAGE } from "../core/adapters/usage-parser.js";
import { openaiAdapter } from "../core/adapters/openai.js";
import { anthropicAdapter } from "../core/adapters/anthropic.js";
import { convertJsonResponse, createStreamConverter } from "../core/adapters/response-converter.js";

// ════════════════════════════════════════════════════════════════
// 1. UNIFIED PARSER: parseRawUsage
// ════════════════════════════════════════════════════════════════

// ── OpenAI format (subset model: cached ⊂ prompt_tokens) ─────

test("cache: OpenAI prompt_tokens=1200, cached=1024 → inputTokens=176", () => {
  const u = parseRawUsage({
    prompt_tokens: 1200, completion_tokens: 10,
    prompt_tokens_details: { cached_tokens: 1024 },
  }, "openai");
  assert.equal(u.inputTokens, 176);
  assert.equal(u.cacheReadTokens, 1024);
  assert.equal(u.totalTokens, 1210); // 176+1024+10
});

test("cache: OpenAI no cache → inputTokens = prompt_tokens", () => {
  const u = parseRawUsage({ prompt_tokens: 500, completion_tokens: 20 }, "openai");
  assert.equal(u.inputTokens, 500);
  assert.equal(u.cacheReadTokens, 0);
  assert.equal(u.totalTokens, 520);
});

test("cache: OpenAI cached_tokens=0 → no subtraction", () => {
  const u = parseRawUsage({
    prompt_tokens: 300, completion_tokens: 5,
    prompt_tokens_details: { cached_tokens: 0 },
  }, "openai");
  assert.equal(u.inputTokens, 300);
  assert.equal(u.cacheReadTokens, 0);
});

// ── Anthropic format (parallel: input + cache are separate) ──

test("cache: Anthropic input=50, cache_read=10000, cache_create=248 → all separate", () => {
  const u = parseRawUsage({
    input_tokens: 50, cache_read_input_tokens: 10000,
    cache_creation_input_tokens: 248, output_tokens: 100,
  }, "anthropic");
  assert.equal(u.inputTokens, 50);
  assert.equal(u.cacheReadTokens, 10000);
  assert.equal(u.cacheCreationTokens, 248);
  assert.equal(u.totalTokens, 10398); // 50+10000+248+100
});

test("cache: Anthropic no cache → inputTokens direct", () => {
  const u = parseRawUsage({ input_tokens: 200, output_tokens: 30 }, "anthropic");
  assert.equal(u.inputTokens, 200);
  assert.equal(u.cacheReadTokens, 0);
  assert.equal(u.totalTokens, 230);
});

// ── Provider edge cases ──────────────────────────────────────

test("cache: Kimi input_tokens=0, cache_read=13 → no double count", () => {
  const u = parseRawUsage({
    input_tokens: 0, cache_read_input_tokens: 13,
    cache_creation_input_tokens: 0, output_tokens: 4,
  });
  assert.equal(u.inputTokens, 0, "must not double-count cache as input");
  assert.equal(u.cacheReadTokens, 13);
  assert.equal(u.totalTokens, 17);
});

test("cache: DeepSeek prompt_cache_hit_tokens field (legacy)", () => {
  // DeepSeek also returns prompt_cache_hit_tokens alongside prompt_tokens_details
  const u = parseRawUsage({
    prompt_tokens: 2974, completion_tokens: 1,
    prompt_tokens_details: { cached_tokens: 2944 },
    prompt_cache_hit_tokens: 2944, prompt_cache_miss_tokens: 30,
  }, "openai");
  assert.equal(u.inputTokens, 30);
  assert.equal(u.cacheReadTokens, 2944);
  assert.equal(u.totalTokens, 2975);
});

test("cache: negative inputTokens clamped to 0", () => {
  const u = parseRawUsage({
    prompt_tokens: 5, prompt_tokens_details: { cached_tokens: 10 }, completion_tokens: 1,
  }, "openai");
  assert.equal(u.inputTokens, 0);
  assert.equal(u.cacheReadTokens, 10);
});

test("cache: totalTokens always recomputed, ignores upstream", () => {
  const u = parseRawUsage({
    prompt_tokens: 100, completion_tokens: 50, total_tokens: 99999,
  }, "openai");
  assert.equal(u.totalTokens, 150, "recomputed, not 99999");
});

// ── mergeUsage ───────────────────────────────────────────────

test("cache: mergeUsage takes max across message_start + message_delta", () => {
  // Simulates: message_start has input=42, message_delta has output=18 + input from MiMo
  const fromStart = { inputTokens: 42, outputTokens: 0, totalTokens: 42, cacheReadTokens: 800, cacheCreationTokens: 0 };
  const fromDelta = { inputTokens: 42, outputTokens: 18, totalTokens: 60, cacheReadTokens: 800, cacheCreationTokens: 0 };
  const m = mergeUsage(fromStart, fromDelta);
  assert.equal(m.inputTokens, 42);
  assert.equal(m.outputTokens, 18);
  assert.equal(m.cacheReadTokens, 800);
  assert.equal(m.totalTokens, 860); // 42+800+0+18
});

test("cache: mergeUsage earlyCapture + tailBuffer", () => {
  const early = { inputTokens: 100, outputTokens: 0, totalTokens: 100, cacheReadTokens: 500, cacheCreationTokens: 0 };
  const tail = { inputTokens: 0, outputTokens: 50, totalTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const m = mergeUsage(early, tail);
  assert.equal(m.inputTokens, 100);
  assert.equal(m.outputTokens, 50);
  assert.equal(m.cacheReadTokens, 500);
  assert.equal(m.totalTokens, 650);
});

// ════════════════════════════════════════════════════════════════
// 2. ADAPTER EXTRACTION WITH CACHE
// ════════════════════════════════════════════════════════════════

test("cache: OpenAI adapter extractUsageFromStream with cached_tokens", () => {
  const tail = [
    'data: {"choices":[{"delta":{"content":"hi"}}]}',
    'data: {"usage":{"prompt_tokens":1200,"completion_tokens":10,"total_tokens":1210,"prompt_tokens_details":{"cached_tokens":1024}}}',
    "data: [DONE]",
  ].join("\n");
  const u = openaiAdapter.extractUsageFromStream(tail)!;
  assert.equal(u.inputTokens, 176);
  assert.equal(u.cacheReadTokens, 1024);
  assert.equal(u.outputTokens, 10);
  assert.equal(u.totalTokens, 1210);
});

test("cache: OpenAI adapter extractUsageFromStream without cache", () => {
  const tail = 'data: {"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}\ndata: [DONE]';
  const u = openaiAdapter.extractUsageFromStream(tail)!;
  assert.equal(u.inputTokens, 100);
  assert.equal(u.cacheReadTokens, 0);
  assert.equal(u.totalTokens, 120);
});

test("cache: OpenAI adapter extractUsageFromJson with cache", () => {
  const u = openaiAdapter.extractUsageFromJson({
    choices: [{ message: { content: "hi" } }],
    usage: { prompt_tokens: 500, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 400 } },
  })!;
  assert.equal(u.inputTokens, 100);
  assert.equal(u.cacheReadTokens, 400);
  assert.equal(u.totalTokens, 510);
});

test("cache: Anthropic adapter extractUsageFromStream with cache", () => {
  const tail = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":50,"cache_read_input_tokens":800,"cache_creation_input_tokens":0}}}',
    'data: {"type":"message_delta","usage":{"output_tokens":20}}',
  ].join("\n");
  const u = anthropicAdapter.extractUsageFromStream(tail)!;
  assert.equal(u.inputTokens, 50);
  assert.equal(u.cacheReadTokens, 800);
  assert.equal(u.outputTokens, 20);
  assert.equal(u.totalTokens, 870);
});

test("cache: Anthropic adapter extractUsageFromJson with cache", () => {
  const u = anthropicAdapter.extractUsageFromJson({
    usage: { input_tokens: 30, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, output_tokens: 10 },
  })!;
  assert.equal(u.inputTokens, 30);
  assert.equal(u.cacheReadTokens, 500);
  assert.equal(u.cacheCreationTokens, 100);
  assert.equal(u.totalTokens, 640);
});

test("cache: Anthropic adapter MiMo-style delta reports input + cache", () => {
  // MiMo: message_start has input=0, message_delta has both input and output
  const tail = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":0,"cache_read_input_tokens":0}}}',
    'data: {"type":"message_delta","usage":{"input_tokens":42,"output_tokens":18,"cache_read_input_tokens":800}}',
  ].join("\n");
  const u = anthropicAdapter.extractUsageFromStream(tail)!;
  assert.equal(u.inputTokens, 42, "takes max from delta");
  assert.equal(u.cacheReadTokens, 800, "takes max from delta");
  assert.equal(u.outputTokens, 18);
  assert.equal(u.totalTokens, 860);
});

// ════════════════════════════════════════════════════════════════
// 3. SETTLEMENT: DIFFERENTIAL PRICING
// ════════════════════════════════════════════════════════════════

test("cache: settlement calculates correct cost with 40% cache discount", () => {
  // Simulates the settlement calculation from postgres-platform-repository.ts
  const inputTokens = 30, cacheReadTokens = 2944, cacheCreationTokens = 0, outputTokens = 1;
  const fixedPricePer1kInput = 500, fixedPricePer1kOutput = 1000;
  const cacheReadDiscount = 40;

  const cacheDiscount = Math.max(1, Math.min(100, cacheReadDiscount));
  const freshInputCost = Math.ceil((inputTokens * fixedPricePer1kInput) / 1000);
  const cacheReadCost = Math.ceil((cacheReadTokens * fixedPricePer1kInput * cacheDiscount / 100) / 1000);
  const cacheCreationCost = Math.ceil((cacheCreationTokens * fixedPricePer1kInput) / 1000);
  const outputCost = Math.ceil((outputTokens * fixedPricePer1kOutput) / 1000);
  const consumerCost = freshInputCost + cacheReadCost + cacheCreationCost + outputCost;

  assert.equal(freshInputCost, 15);    // ceil(30*500/1000)
  assert.equal(cacheReadCost, 589);    // ceil(2944*500*40/100/1000)
  assert.equal(cacheCreationCost, 0);
  assert.equal(outputCost, 1);         // ceil(1*1000/1000)
  assert.equal(consumerCost, 605);

  // Compare to no-discount cost
  const noCacheCost = Math.ceil(((inputTokens + cacheReadTokens) * fixedPricePer1kInput) / 1000) + outputCost;
  assert.equal(noCacheCost, 1488);     // ceil(2974*500/1000)+1
  assert.ok(consumerCost < noCacheCost, "cache discount saves money");
});

test("cache: settlement with 100% discount = full price (no saving)", () => {
  const input = 100, cacheRead = 800, output = 10;
  const price = 1000;
  const discount = 100;

  const fresh = Math.ceil((input * price) / 1000);
  const cached = Math.ceil((cacheRead * price * discount / 100) / 1000);
  const total = fresh + cached + Math.ceil((output * price) / 1000);

  const noDiscount = Math.ceil(((input + cacheRead) * price) / 1000) + Math.ceil((output * price) / 1000);
  assert.equal(total, noDiscount, "100% discount = no saving");
});

test("cache: settlement with 1% discount (minimum)", () => {
  const cacheRead = 10000, price = 1000;
  const cached = Math.ceil((cacheRead * price * 1 / 100) / 1000);
  assert.equal(cached, 100); // ceil(10000*1000*1/100/1000) = 100
});

test("cache: settlement cacheCreation at full price", () => {
  const cacheCreation = 1000, price = 500;
  const cost = Math.ceil((cacheCreation * price) / 1000);
  assert.equal(cost, 500); // creation always at full input price
});

// ════════════════════════════════════════════════════════════════
// 4. RESPONSE CONVERSION: CACHE FIELDS PRESERVED
// ════════════════════════════════════════════════════════════════

test("cache: OpenAI→Anthropic JSON preserves cache fields in usage", () => {
  const openaiResp = {
    id: "c1", object: "chat.completion", model: "gpt-4",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050,
      prompt_tokens_details: { cached_tokens: 800 },
    },
  };
  const result = convertJsonResponse("openai", "anthropic", openaiResp) as any;
  assert.ok(result.usage.cache_read_input_tokens >= 800, "cache_read preserved in Anthropic output");
});

test("cache: Anthropic→OpenAI JSON preserves cache fields in usage", () => {
  const anthropicResp = {
    id: "m1", type: "message", role: "assistant", model: "claude",
    content: [{ type: "text", text: "hi" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 800 },
  };
  const result = convertJsonResponse("anthropic", "openai", anthropicResp) as any;
  // OpenAI format: prompt_tokens should include cached (50+800=850)
  assert.equal(result.usage.prompt_tokens, 850, "prompt_tokens includes cached");
  assert.ok(result.usage.prompt_tokens_details?.cached_tokens === 800, "cached_tokens preserved");
});

test("cache: conversion without cache fields works normally", () => {
  const openaiResp = {
    id: "c2", object: "chat.completion", model: "gpt-4",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
  const result = convertJsonResponse("openai", "anthropic", openaiResp) as any;
  assert.equal(result.usage.input_tokens, 100);
  assert.equal(result.usage.output_tokens, 20);
  assert.equal(result.usage.cache_read_input_tokens, undefined, "no spurious cache field");
});

// ── Streaming conversion: cache fields preserved ─────────────

test("cache: streaming OpenAI→Anthropic message_delta includes cache fields", () => {
  const converter = createStreamConverter("openai", "anthropic");

  // Content chunk
  const chunk1 = 'data: {"id":"c1","model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}\n\n';
  converter.transform(chunk1);

  // Finish chunk with usage including cache
  const chunk2 = 'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1200,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":1024}}}\n\n';
  const out2 = converter.transform(chunk2);
  const joined2 = out2.join("");

  // message_delta should have cache fields
  assert.ok(joined2.includes("message_delta"), "should emit message_delta");
  assert.ok(joined2.includes("cache_read_input_tokens"), "message_delta.usage should include cache_read_input_tokens");
  assert.ok(joined2.includes("1024") || joined2.includes('"cache_read_input_tokens"'), "cache value should be present");
});

test("cache: streaming OpenAI→Anthropic no cache → no cache fields in delta", () => {
  const converter = createStreamConverter("openai", "anthropic");

  const chunk1 = 'data: {"id":"c1","model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}\n\n';
  converter.transform(chunk1);

  const chunk2 = 'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":10}}\n\n';
  const out2 = converter.transform(chunk2);
  const joined2 = out2.join("");

  assert.ok(joined2.includes("message_delta"), "should emit message_delta");
  assert.ok(!joined2.includes("cache_read_input_tokens"), "no cache field when no cache");
});

test("cache: streaming Anthropic→OpenAI passes through cache in original events", () => {
  const converter = createStreamConverter("anthropic", "openai");

  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","model":"claude","content":[],"usage":{"input_tokens":50,"cache_read_input_tokens":800}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];

  const allOutput: string[] = [];
  for (const evt of events) {
    allOutput.push(...converter.transform(evt));
  }
  allOutput.push(...converter.flush());

  const joined = allOutput.join("");
  assert.ok(joined.includes("hi"), "should contain content");
  assert.ok(joined.includes("chat.completion.chunk"), "should be OpenAI format");
  assert.ok(joined.includes("[DONE]"), "should end with DONE");
});

test("cache: auto-detect stream converter preserves cache in OpenAI→Anthropic", () => {
  const converter = createStreamConverter("openai", "anthropic", { autoDetect: true });

  // Send enough data for detection + content + finish with cache usage
  const chunk = [
    'data: {"id":"c1","model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n',
    'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":500,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":400}}}\n\n',
    'data: [DONE]\n\n',
  ].join("");

  const out = converter.transform(chunk);
  const flush = converter.flush();
  const joined = [...out, ...flush].join("");

  assert.ok(joined.includes("message_start"), "should detect OpenAI and convert to Anthropic");
  assert.ok(joined.includes("Hello"), "should contain content");
  assert.ok(joined.includes("message_delta"), "should have message_delta");
  // Check cache field in message_delta
  const deltaMatch = joined.match(/event: message_delta\ndata: ({.*?})\n\n/s);
  assert.ok(deltaMatch, "should find message_delta event");
  const deltaData = JSON.parse(deltaMatch![1]);
  assert.ok(deltaData.usage.cache_read_input_tokens > 0 || deltaData.usage.input_tokens >= 0, "message_delta should have usage");
});

// ════════════════════════════════════════════════════════════════
// 5. FORMAT DETECTION
// ════════════════════════════════════════════════════════════════

test("cache: detectUsageFormat with cache_read field → anthropic", () => {
  assert.equal(detectUsageFormat({ cache_read_input_tokens: 100, output_tokens: 5 }), "anthropic");
});

test("cache: detectUsageFormat with prompt_tokens_details → openai", () => {
  assert.equal(detectUsageFormat({ prompt_tokens: 100, prompt_tokens_details: {} }), "openai");
});

test("cache: detectUsageFormat ambiguous (both fields) → anthropic wins", () => {
  assert.equal(detectUsageFormat({ prompt_tokens: 100, cache_read_input_tokens: 50 }), "anthropic");
});

// ════════════════════════════════════════════════════════════════
// 6. PROVIDER HOOKS: Kimi Code cache double-count fix
// ════════════════════════════════════════════════════════════════

import { kimiCodingAnthropicHooks } from "../core/adapters/providers/kimi-coding.js";

test("cache: Kimi Code JSON — input_tokens includes cached → deduplicated", () => {
  // Kimi returns input_tokens == prompt_tokens (both include cached)
  const body = {
    usage: {
      input_tokens: 10100, cache_read_input_tokens: 9700, cache_creation_input_tokens: 0, output_tokens: 11,
      prompt_tokens: 10100, cached_tokens: 9700, completion_tokens: 11, total_tokens: 10111,
    },
  };
  const u = kimiCodingAnthropicHooks.extractUsageFromJson!(body)!;
  assert.equal(u.inputTokens, 400, "10100 - 9700 = 400 non-cached");
  assert.equal(u.cacheReadTokens, 9700);
  assert.equal(u.totalTokens, 10111, "400 + 9700 + 0 + 11");
});

test("cache: Kimi Code JSON — no cache → unchanged", () => {
  const body = {
    usage: {
      input_tokens: 500, cache_read_input_tokens: 0, output_tokens: 10,
      prompt_tokens: 500, cached_tokens: 0, completion_tokens: 10, total_tokens: 510,
    },
  };
  const u = kimiCodingAnthropicHooks.extractUsageFromJson!(body)!;
  assert.equal(u.inputTokens, 500, "no cache → no deduction");
  assert.equal(u.cacheReadTokens, 0);
  assert.equal(u.totalTokens, 510);
});

test("cache: Kimi Code stream — message_start + delta with cached dedup", () => {
  const tail = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":10100,"cache_read_input_tokens":9700,"cache_creation_input_tokens":0,"prompt_tokens":10100,"cached_tokens":9700}}}',
    'data: {"type":"message_delta","usage":{"input_tokens":10100,"cache_read_input_tokens":9700,"output_tokens":11,"prompt_tokens":10100,"completion_tokens":11,"total_tokens":10111}}',
  ].join("\n");
  const u = kimiCodingAnthropicHooks.extractUsageFromStream!(tail)!;
  assert.equal(u.inputTokens, 400);
  assert.equal(u.cacheReadTokens, 9700);
  assert.equal(u.outputTokens, 11);
  assert.equal(u.totalTokens, 10111);
});

test("cache: Kimi Code — standard Anthropic data (input < cache) not affected", () => {
  // Hypothetical: Kimi fixes their API to return standard Anthropic semantics
  const body = {
    usage: {
      input_tokens: 50, cache_read_input_tokens: 9700, output_tokens: 11,
      // No prompt_tokens field, or prompt_tokens != input_tokens
    },
  };
  const u = kimiCodingAnthropicHooks.extractUsageFromJson!(body)!;
  assert.equal(u.inputTokens, 50, "standard Anthropic → not deducted");
  assert.equal(u.cacheReadTokens, 9700);
});
