import assert from "node:assert/strict";
import test from "node:test";

import { openaiAdapter } from "../core/adapters/openai.js";
import { anthropicAdapter } from "../core/adapters/anthropic.js";

// ── OpenAI adapter ──────────────────────────────────────────────────

test("openai buildUrl: appends /v1/chat/completions to base URL", () => {
  assert.equal(
    openaiAdapter.buildUrl("https://api.openai.com"),
    "https://api.openai.com/v1/chat/completions",
  );
});

test("openai buildUrl: strips trailing slash before appending", () => {
  assert.equal(
    openaiAdapter.buildUrl("https://api.openai.com/"),
    "https://api.openai.com/v1/chat/completions",
  );
});

test("openai buildUrl: URL already ending with /v1 only appends /chat/completions", () => {
  assert.equal(
    openaiAdapter.buildUrl("https://api.openai.com/v1"),
    "https://api.openai.com/v1/chat/completions",
  );
});

test("openai buildHeaders: includes Bearer token and content-type", () => {
  const headers = openaiAdapter.buildHeaders("sk-test-key");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["authorization"], "Bearer sk-test-key");
  assert.equal(headers["user-agent"], "xllmapi/1.0");
});

test("openai buildHeaders: uses custom user-agent when provided", () => {
  const headers = openaiAdapter.buildHeaders("sk-test-key", "my-agent/2.0");
  assert.equal(headers["user-agent"], "my-agent/2.0");
});

test("openai prepareBody: replaces model with realModel", () => {
  const body = { model: "alias-model", messages: [{ role: "user", content: "hi" }] };
  const prepared = openaiAdapter.prepareBody(body, "gpt-4o");
  assert.equal(prepared.model, "gpt-4o");
});

test("openai prepareBody: caps max_tokens at 8192", () => {
  const body = { model: "gpt-4o", max_tokens: 100_000 };
  const prepared = openaiAdapter.prepareBody(body, "gpt-4o");
  assert.equal(prepared.max_tokens, 8192);

  const bodySmall = { model: "gpt-4o", max_tokens: 512 };
  const preparedSmall = openaiAdapter.prepareBody(bodySmall, "gpt-4o");
  assert.equal(preparedSmall.max_tokens, 512);
});

test("openai extractUsageFromStream: extracts usage from valid data line", () => {
  const tail = [
    'data: {"choices":[{"delta":{"content":"hi"}}]}',
    'data: {"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}',
    "data: [DONE]",
  ].join("\n");

  const usage = openaiAdapter.extractUsageFromStream(tail);
  assert.deepEqual(usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
});

test("openai extractUsageFromStream: returns undefined when no usage present", () => {
  const tail = [
    'data: {"choices":[{"delta":{"content":"hello"}}]}',
    "data: [DONE]",
  ].join("\n");

  assert.equal(openaiAdapter.extractUsageFromStream(tail), undefined);
});

test("openai extractUsageFromJson: extracts usage from response body", () => {
  const body = {
    choices: [{ message: { content: "hi" } }],
    usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 },
  };

  const usage = openaiAdapter.extractUsageFromJson(body);
  assert.deepEqual(usage, { inputTokens: 5, outputTokens: 15, totalTokens: 20 });
});

// ── Anthropic adapter ───────────────────────────────────────────────

test("anthropic buildUrl: appends /v1/messages to base URL", () => {
  assert.equal(
    anthropicAdapter.buildUrl("https://api.anthropic.com"),
    "https://api.anthropic.com/v1/messages",
  );
});

test("anthropic buildHeaders: includes x-api-key and anthropic-version", () => {
  const headers = anthropicAdapter.buildHeaders("sk-ant-test");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["x-api-key"], "sk-ant-test");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers["user-agent"], "xllmapi/1.0");
});

test("anthropic extractUsageFromStream: extracts from message_start + message_delta", () => {
  const tail = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":42}}}',
    'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
    'data: {"type":"message_delta","usage":{"output_tokens":18}}',
  ].join("\n");

  const usage = anthropicAdapter.extractUsageFromStream(tail);
  assert.deepEqual(usage, { inputTokens: 42, outputTokens: 18, totalTokens: 60 });
});

test("anthropic extractUsageFromStream: returns undefined when no usage events", () => {
  const tail = [
    'data: {"type":"content_block_delta","delta":{"text":"hi"}}',
    'data: {"type":"message_stop"}',
  ].join("\n");

  assert.equal(anthropicAdapter.extractUsageFromStream(tail), undefined);
});

test("anthropic extractUsageFromJson: extracts usage with input/output tokens", () => {
  const body = {
    content: [{ type: "text", text: "hi" }],
    usage: { input_tokens: 8, output_tokens: 12 },
  };

  const usage = anthropicAdapter.extractUsageFromJson(body);
  assert.deepEqual(usage, { inputTokens: 8, outputTokens: 12, totalTokens: 20 });
});
