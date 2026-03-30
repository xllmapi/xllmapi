import assert from "node:assert/strict";
import test from "node:test";

import { find_bearer_token_, get_request_ip_, json, match_id_route_, has_legacy_model_prefix_ } from "../lib/http.js";

// --- find_bearer_token_ ---

test("find_bearer_token_ extracts token from valid Bearer header", () => {
  assert.equal(find_bearer_token_("Bearer abc123"), "abc123");
});

test("find_bearer_token_ is case insensitive on scheme", () => {
  assert.equal(find_bearer_token_("bearer abc123"), "abc123");
  assert.equal(find_bearer_token_("BEARER abc123"), "abc123");
});

test("find_bearer_token_ returns null for wrong scheme", () => {
  assert.equal(find_bearer_token_("Basic abc123"), null);
});

test("find_bearer_token_ returns null for undefined, empty, or missing value", () => {
  assert.equal(find_bearer_token_(undefined), null);
  assert.equal(find_bearer_token_(""), null);
  assert.equal(find_bearer_token_("Bearer"), null);
});

test("find_bearer_token_ trims whitespace from token value", () => {
  assert.equal(find_bearer_token_("Bearer  spaced "), null, "split(' ', 2) yields empty value for double-space");
  assert.equal(find_bearer_token_("Bearer token "), "token");
});

// --- get_request_ip_ ---

const mockReq = (headers: Record<string, string | undefined>, remoteAddress?: string) => ({
  headers,
  socket: { remoteAddress }
}) as any;

test("get_request_ip_ returns first IP from X-Forwarded-For", () => {
  assert.equal(get_request_ip_(mockReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "1.2.3.4");
  assert.equal(get_request_ip_(mockReq({ "x-forwarded-for": "1.2.3.4" })), "1.2.3.4");
});

test("get_request_ip_ falls back to socket.remoteAddress when no X-Forwarded-For", () => {
  assert.equal(get_request_ip_(mockReq({}, "10.0.0.1")), "10.0.0.1");
  assert.equal(get_request_ip_(mockReq({ "x-forwarded-for": "" }, "10.0.0.1")), "10.0.0.1");
  assert.equal(get_request_ip_(mockReq({ "x-forwarded-for": "  " }, "10.0.0.1")), "10.0.0.1");
});

test("get_request_ip_ returns unknown when no address available", () => {
  assert.equal(get_request_ip_(mockReq({})), "unknown");
});

// --- json ---

test("json returns correct response structure", () => {
  const result = json(200, { ok: true });

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(result.payload, JSON.stringify({ ok: true }, null, 2));
  assert.equal(result.headers["content-length"], Buffer.byteLength(result.payload).toString());
});

test("json handles different status codes and complex bodies", () => {
  const body = { error: { message: "not found", code: 404 }, items: [1, 2, 3] };
  const result = json(404, body);

  assert.equal(result.statusCode, 404);
  assert.deepEqual(JSON.parse(result.payload), body);
});

// --- match_id_route_ ---

test("match_id_route_ extracts id from matching path", () => {
  assert.equal(match_id_route_("/v1/users/abc", "/v1/users/"), "abc");
  assert.equal(match_id_route_("/v1/users/123-456", "/v1/users/"), "123-456");
});

test("match_id_route_ returns null for edge cases", () => {
  assert.equal(match_id_route_("/v1/users/", "/v1/users/"), null, "empty id");
  assert.equal(match_id_route_("/v1/users/abc/extra", "/v1/users/"), null, "contains slash");
  assert.equal(match_id_route_("/other/path", "/v1/users/"), null, "wrong prefix");
});

// --- has_legacy_model_prefix_ ---

test("has_legacy_model_prefix_ detects xllm/ prefix", () => {
  assert.equal(has_legacy_model_prefix_("xllm/deepseek-chat"), true);
  assert.equal(has_legacy_model_prefix_("  xllm/model"), true);
  assert.equal(has_legacy_model_prefix_("deepseek-chat"), false);
  assert.equal(has_legacy_model_prefix_("XLLM/model"), false);
});
