import assert from "node:assert/strict";
import test from "node:test";

import { resolveUpstreamHeaders } from "../core/provider-executor.js";

const BASE_HEADERS = {
  "content-type": "application/json",
  authorization: "Bearer sk-test",
  "user-agent": "xllmapi/1.0",
};

// ── No config (transparent passthrough) ──

test("no config + coding agent UA → passthrough", () => {
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, undefined, "claude-code/1.0.23");
  assert.equal(result["user-agent"], "claude-code/1.0.23");
});

test("no config + browser UA → keeps adapter default (not passthrough)", () => {
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, undefined, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
  assert.equal(result["user-agent"], "xllmapi/1.0");
});

test("no config + no client UA → keeps adapter default", () => {
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, undefined, undefined);
  assert.equal(result["user-agent"], "xllmapi/1.0");
});

// ── Fallback mode ──

test("fallback + coding agent UA → uses coding agent UA", () => {
  const config = {
    headers: { "user-agent": { value: "claude-code/1.0", mode: "fallback" as const } },
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, "roo-code/1.2.0");
  assert.equal(result["user-agent"], "roo-code/1.2.0");
});

test("fallback + browser UA → uses fallback value (not browser UA)", () => {
  const config = {
    headers: { "user-agent": { value: "claude-code/1.0", mode: "fallback" as const } },
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, "Mozilla/5.0 Chrome/120");
  assert.equal(result["user-agent"], "claude-code/1.0");
});

test("fallback + no UA → uses fallback value", () => {
  const config = {
    headers: { "user-agent": { value: "claude-code/1.0", mode: "fallback" as const } },
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, undefined);
  assert.equal(result["user-agent"], "claude-code/1.0");
});

// ── Force mode ──

test("force + coding agent UA → uses forced value (ignores client)", () => {
  const config = {
    headers: { "user-agent": { value: "forced-agent/2.0", mode: "force" as const } },
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, "claude-code/1.0.23");
  assert.equal(result["user-agent"], "forced-agent/2.0");
});

test("force + browser UA → uses forced value", () => {
  const config = {
    headers: { "user-agent": { value: "forced-agent/2.0", mode: "force" as const } },
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, "Mozilla/5.0");
  assert.equal(result["user-agent"], "forced-agent/2.0");
});

// ── $CLIENT_USER_AGENT placeholder ──

test("$CLIENT_USER_AGENT resolves to coding agent UA", () => {
  const config = {
    headers: { "user-agent": { value: "$CLIENT_USER_AGENT", mode: "force" as const } },
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, "claude-code/1.0.23");
  assert.equal(result["user-agent"], "claude-code/1.0.23");
});

test("$CLIENT_USER_AGENT with browser UA falls back to claude-code/1.0", () => {
  const config = {
    headers: { "user-agent": { value: "$CLIENT_USER_AGENT", mode: "force" as const } },
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, "Mozilla/5.0");
  assert.equal(result["user-agent"], "claude-code/1.0");
});

test("$CLIENT_USER_AGENT with no UA falls back to claude-code/1.0", () => {
  const config = {
    headers: { "user-agent": { value: "$CLIENT_USER_AGENT", mode: "force" as const } },
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, undefined);
  assert.equal(result["user-agent"], "claude-code/1.0");
});

// ── Custom headers + passthrough ──

test("custom header added alongside coding agent UA passthrough", () => {
  const config = {
    headers: { "x-custom": { value: "my-value", mode: "force" as const } },
    passthrough: true,
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, "claude-code/1.0.23");
  assert.equal(result["x-custom"], "my-value");
  assert.equal(result["user-agent"], "claude-code/1.0.23");
});

test("passthrough=false + no UA rule → keeps adapter default", () => {
  const config = {
    headers: { "x-custom": { value: "val", mode: "force" as const } },
    passthrough: false,
  };
  const result = resolveUpstreamHeaders({ ...BASE_HEADERS }, config, "claude-code/1.0.23");
  assert.equal(result["user-agent"], "xllmapi/1.0");
  assert.equal(result["x-custom"], "val");
});
