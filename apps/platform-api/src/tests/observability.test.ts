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

// Helper: intercept stdout to capture logger JSON output
function captureStdout(fn: () => void): string[] {
  const captured: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = origWrite as typeof process.stdout.write;
  }
  return captured;
}

test("logger child() inherits parent context via createLogger", () => {
  const child = createLogger({
    module: "test-parent",
    pretty: false,
    _parentContext: { requestId: "req_123", userId: "user_abc", module: "test-parent" },
  });

  const captured = captureStdout(() => child.info("test message", { extra: "data" }));

  assert.ok(captured.length >= 1, `expected output but got ${captured.length} lines`);
  const entry = JSON.parse(captured[0]);
  assert.equal(entry.module, "test-parent");
  assert.equal(entry.requestId, "req_123");
  assert.equal(entry.userId, "user_abc");
  assert.equal(entry.message, "test message");
  assert.equal(entry.extra, "data");
  assert.equal(entry.level, "info");
  assert.ok(entry.timestamp);
});

test("logger child() produced by parent.child() merges context", () => {
  const parent = createLogger({ module: "parent-mod", pretty: false });
  const child = parent.child({ module: "child-mod", nodeId: "node_1" });

  const captured = captureStdout(() => child.warn("warning msg"));

  const entry = JSON.parse(captured[0]);
  assert.equal(entry.module, "child-mod");
  assert.equal(entry.nodeId, "node_1");
  assert.equal(entry.level, "warn");
});

test("logger respects log level filtering", () => {
  const logger = createLogger({ module: "test", level: "warn", pretty: false });

  const captured = captureStdout(() => {
    logger.debug("should not appear");
    logger.info("should not appear");
    logger.warn("should appear");
    logger.error("should appear too");
  });

  // Each console.log produces one stdout.write call (with newline)
  const jsonLines = captured.join("").trim().split("\n").filter(l => l.trim());
  assert.equal(jsonLines.length, 2);
  assert.match(jsonLines[0], /should appear/);
  assert.match(jsonLines[1], /should appear too/);
});

test("logger JSON output includes timestamp and level", () => {
  const logger = createLogger({ module: "ts-test", pretty: false });

  const captured = captureStdout(() => logger.info("hello"));

  const entry = JSON.parse(captured[0]);
  assert.ok(entry.timestamp);
  assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(entry.level, "info");
  assert.equal(entry.message, "hello");
  assert.equal(entry.module, "ts-test");
});
