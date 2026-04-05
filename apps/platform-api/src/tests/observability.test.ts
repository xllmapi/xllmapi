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

test("logger child() inherits parent context", () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const parent = createLogger({ module: "test-parent", pretty: false });
    const child = parent.child({ requestId: "req_123", userId: "user_abc" });
    child.info("test message", { extra: "data" });

    assert.equal(logs.length, 1);
    const entry = JSON.parse(logs[0]);
    assert.equal(entry.module, "test-parent");
    assert.equal(entry.requestId, "req_123");
    assert.equal(entry.userId, "user_abc");
    assert.equal(entry.message, "test message");
    assert.equal(entry.extra, "data");
    assert.equal(entry.level, "info");
    assert.ok(entry.timestamp);
  } finally {
    console.log = origLog;
  }
});

test("logger child() can override parent module", () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const parent = createLogger({ module: "parent-mod", pretty: false });
    const child = parent.child({ module: "child-mod", nodeId: "node_1" });
    child.warn("warning msg");

    const entry = JSON.parse(logs[0]);
    assert.equal(entry.module, "child-mod");
    assert.equal(entry.nodeId, "node_1");
    assert.equal(entry.level, "warn");
  } finally {
    console.log = origLog;
  }
});

test("logger respects log level filtering", () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const logger = createLogger({ module: "test", level: "warn", pretty: false });
    logger.debug("should not appear");
    logger.info("should not appear");
    logger.warn("should appear");
    logger.error("should appear");

    assert.equal(logs.length, 2);
    assert.match(logs[0], /should appear/);
    assert.match(logs[1], /should appear/);
  } finally {
    console.log = origLog;
  }
});

test("logger JSON output includes timestamp and level", () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const logger = createLogger({ module: "ts-test", pretty: false });
    logger.info("hello");

    const entry = JSON.parse(logs[0]);
    assert.ok(entry.timestamp);
    assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(entry.level, "info");
    assert.equal(entry.message, "hello");
    assert.equal(entry.module, "ts-test");
  } finally {
    console.log = origLog;
  }
});
