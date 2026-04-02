import assert from "node:assert/strict";
import test from "node:test";

import { formatApiError } from "../lib/errors.js";

// ── OpenAI format ──────────────────────────────────────────────

test("formatApiError: OpenAI format has correct structure", () => {
  const result = formatApiError("openai", 400, "invalid model") as any;

  assert.ok(result.error, "should have error field");
  assert.equal(result.error.message, "invalid model");
  assert.equal(result.error.type, "invalid_request_error");
  assert.equal(result.error.param, null);
  assert.equal(result.error.code, null);
  assert.equal(result.type, undefined, "OpenAI format should not have top-level type");
});

test("formatApiError: OpenAI 401 maps to authentication_error", () => {
  const result = formatApiError("openai", 401, "unauthorized") as any;
  assert.equal(result.error.type, "authentication_error");
});

test("formatApiError: OpenAI 429 maps to rate_limit_error", () => {
  const result = formatApiError("openai", 429, "rate limit") as any;
  assert.equal(result.error.type, "rate_limit_error");
});

test("formatApiError: OpenAI 402 maps to invalid_request_error", () => {
  const result = formatApiError("openai", 402, "insufficient balance") as any;
  assert.equal(result.error.type, "invalid_request_error");
});

test("formatApiError: OpenAI 404 maps to invalid_request_error", () => {
  const result = formatApiError("openai", 404, "not found") as any;
  assert.equal(result.error.type, "invalid_request_error");
});

test("formatApiError: OpenAI 500/502/503 maps to server_error", () => {
  for (const status of [500, 502, 503]) {
    const result = formatApiError("openai", status, "server error") as any;
    assert.equal(result.error.type, "server_error", `status ${status} should map to server_error`);
  }
});

// ── Anthropic format ───────────────────────────────────────────

test("formatApiError: Anthropic format has correct structure", () => {
  const result = formatApiError("anthropic", 400, "invalid model") as any;

  assert.equal(result.type, "error", "should have type: error");
  assert.ok(result.error, "should have error field");
  assert.equal(result.error.type, "invalid_request_error");
  assert.equal(result.error.message, "invalid model");
  assert.equal(result.error.param, undefined, "Anthropic error should not have param");
  assert.equal(result.error.code, undefined, "Anthropic error should not have code");
});

test("formatApiError: Anthropic 401 maps to authentication_error", () => {
  const result = formatApiError("anthropic", 401, "unauthorized") as any;
  assert.equal(result.error.type, "authentication_error");
});

test("formatApiError: Anthropic 429 maps to rate_limit_error", () => {
  const result = formatApiError("anthropic", 429, "rate limit") as any;
  assert.equal(result.error.type, "rate_limit_error");
});

test("formatApiError: Anthropic 404 maps to not_found_error", () => {
  const result = formatApiError("anthropic", 404, "not found") as any;
  assert.equal(result.error.type, "not_found_error");
});

test("formatApiError: Anthropic 529 maps to overloaded_error", () => {
  const result = formatApiError("anthropic", 529, "overloaded") as any;
  assert.equal(result.error.type, "overloaded_error");
});

test("formatApiError: Anthropic 500/502 maps to api_error", () => {
  for (const status of [500, 502]) {
    const result = formatApiError("anthropic", status, "server error") as any;
    assert.equal(result.error.type, "api_error", `status ${status} should map to api_error`);
  }
});

// ── xllmapi extension field ────────────────────────────────────

test("formatApiError: xllmapi meta attached when provided (OpenAI)", () => {
  const result = formatApiError("openai", 429, "rate limit", {
    requestId: "req_123",
    resetAt: "2026-04-02T22:50:00Z",
  }) as any;

  assert.ok(result.xllmapi, "should have xllmapi extension");
  assert.equal(result.xllmapi.requestId, "req_123");
  assert.equal(result.xllmapi.resetAt, "2026-04-02T22:50:00Z");
  // error structure still intact
  assert.equal(result.error.type, "rate_limit_error");
});

test("formatApiError: xllmapi meta attached when provided (Anthropic)", () => {
  const result = formatApiError("anthropic", 402, "insufficient balance", {
    requestId: "req_456",
  }) as any;

  assert.equal(result.type, "error");
  assert.ok(result.xllmapi, "should have xllmapi extension");
  assert.equal(result.xllmapi.requestId, "req_456");
  assert.equal(result.error.message, "insufficient balance");
});

test("formatApiError: no xllmapi field when meta is undefined", () => {
  const result = formatApiError("openai", 400, "bad request") as any;
  assert.equal(result.xllmapi, undefined, "should not have xllmapi when no meta");
});

test("formatApiError: no xllmapi field when meta is empty object", () => {
  const result = formatApiError("openai", 400, "bad request", {}) as any;
  assert.equal(result.xllmapi, undefined, "should not have xllmapi when meta is empty");
});

test("formatApiError: custom meta fields preserved", () => {
  const result = formatApiError("openai", 503, "unavailable", {
    requestId: "req_789",
    offeringId: "off_123",
    retryable: true,
  }) as any;

  assert.equal(result.xllmapi.requestId, "req_789");
  assert.equal(result.xllmapi.offeringId, "off_123");
  assert.equal(result.xllmapi.retryable, true);
});
