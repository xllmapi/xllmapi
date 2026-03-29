import assert from "node:assert/strict";
import test from "node:test";

import { classifyError } from "../core/provider-executor.js";

test("classifyError: 401 → fatal", () => {
  assert.equal(classifyError(401, "unauthorized"), "fatal");
});

test("classifyError: 403 quota → degraded", () => {
  assert.equal(classifyError(403, "You've reached your usage limit"), "degraded");
  assert.equal(classifyError(403, "quota exceeded"), "degraded");
  assert.equal(classifyError(403, "billing cycle"), "degraded");
});

test("classifyError: 403 agent restriction → fatal", () => {
  assert.equal(classifyError(403, "only available for Coding Agents"), "fatal");
  assert.equal(classifyError(403, '{"type":"access_terminated_error"}'), "fatal");
});

test("classifyError: 403 generic → degraded", () => {
  assert.equal(classifyError(403, "forbidden"), "degraded");
});

test("classifyError: 429 → transient", () => {
  assert.equal(classifyError(429, "rate limited"), "transient");
});

test("classifyError: 500/502/503 → transient", () => {
  assert.equal(classifyError(500, "internal error"), "transient");
  assert.equal(classifyError(502, "bad gateway"), "transient");
  assert.equal(classifyError(503, "service unavailable"), "transient");
});

test("classifyError: other 4xx → transient", () => {
  assert.equal(classifyError(400, "bad request"), "transient");
  assert.equal(classifyError(404, "not found"), "transient");
});
