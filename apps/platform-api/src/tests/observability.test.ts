import assert from "node:assert/strict";
import test from "node:test";

import { metricsService } from "../metrics.js";
import { createLogger } from "@xllmapi/logger";

// ── Metrics Tests ──────────────────────────────────────────────────

test("new metrics render in prometheus output", () => {
  const rendered = metricsService.renderPrometheus({ env: "test", release_id: "unit" });

  assert.match(rendered, /# HELP xllmapi_failed_api_requests/);
  assert.match(rendered, /xllmapi_failed_api_requests\{env="test",release_id="unit"\} \d+/);

  assert.match(rendered, /# HELP xllmapi_daily_limit_exhausted/);
  assert.match(rendered, /xllmapi_daily_limit_exhausted\{env="test",release_id="unit"\} \d+/);

  assert.match(rendered, /# HELP xllmapi_provider_errors/);
  assert.match(rendered, /xllmapi_provider_errors\{env="test",release_id="unit"\} \d+/);
});

test("metrics increment works for new fields", () => {
  const before = metricsService.snapshot();
  metricsService.increment("failedApiRequests");
  metricsService.increment("dailyLimitExhausted");
  metricsService.increment("providerErrors");
  metricsService.increment("providerErrors");
  const after = metricsService.snapshot();

  assert.equal(after.failedApiRequests, before.failedApiRequests + 1);
  assert.equal(after.dailyLimitExhausted, before.dailyLimitExhausted + 1);
  assert.equal(after.providerErrors, before.providerErrors + 2);
});

// ── Logger Tests ───────────────────────────────────────────────────

test("logger child() inherits parent context via _parentContext", () => {
  const lines: string[] = [];
  const child = createLogger({
    module: "test-parent",
    pretty: false,
    _parentContext: { requestId: "req_123", userId: "user_abc", module: "test-parent" },
    _writer: (line) => lines.push(line),
  });

  child.info("test message", { extra: "data" });

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.module, "test-parent");
  assert.equal(entry.requestId, "req_123");
  assert.equal(entry.userId, "user_abc");
  assert.equal(entry.message, "test message");
  assert.equal(entry.extra, "data");
  assert.equal(entry.level, "info");
  assert.ok(entry.timestamp);
});

test("logger parent.child() merges context and inherits _writer", () => {
  const lines: string[] = [];
  const parent = createLogger({ module: "parent-mod", pretty: false, _writer: (line) => lines.push(line) });
  const child = parent.child({ module: "child-mod", nodeId: "node_1" });

  child.warn("warning msg");

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.module, "child-mod");
  assert.equal(entry.nodeId, "node_1");
  assert.equal(entry.level, "warn");
});

test("logger respects log level filtering", () => {
  const lines: string[] = [];
  const logger = createLogger({ module: "test", level: "warn", pretty: false, _writer: (line) => lines.push(line) });

  logger.debug("should not appear");
  logger.info("should not appear");
  logger.warn("should appear");
  logger.error("should appear too");

  assert.equal(lines.length, 2);
  assert.match(lines[0], /should appear/);
  assert.match(lines[1], /should appear too/);
});

test("logger JSON output includes timestamp and level", () => {
  const lines: string[] = [];
  const logger = createLogger({ module: "ts-test", pretty: false, _writer: (line) => lines.push(line) });

  logger.info("hello");

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.ok(entry.timestamp);
  assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(entry.level, "info");
  assert.equal(entry.message, "hello");
  assert.equal(entry.module, "ts-test");
});
