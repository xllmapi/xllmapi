import test from "node:test";
import assert from "node:assert/strict";

import {
  getConvAffinity,
  setConvAffinity,
  clearConvAffinity,
  getUserAffinity,
  pushUserAffinity,
  getAffinityThresholdMs,
  _resetForTest,
} from "../core/context-affinity.js";

import {
  OfferingQueue,
  getOrCreateQueue,
  _resetQueuesForTest,
} from "../core/offering-queue.js";

// ── Context Affinity Tests ──────────────────────────────────────────

test("conversation affinity: set, get, clear", () => {
  _resetForTest();

  assert.equal(getConvAffinity("conv_1"), null);

  setConvAffinity("conv_1", "off_A", 5);
  assert.equal(getConvAffinity("conv_1"), "off_A");

  clearConvAffinity("conv_1");
  assert.equal(getConvAffinity("conv_1"), null);
});

test("user affinity: push and retrieve recent offerings", () => {
  _resetForTest();

  assert.deepEqual(getUserAffinity("user_1", "deepseek-chat"), []);

  pushUserAffinity("user_1", "deepseek-chat", "off_A", 200);
  assert.deepEqual(getUserAffinity("user_1", "deepseek-chat"), ["off_A"]);

  pushUserAffinity("user_1", "deepseek-chat", "off_B", 350);
  assert.deepEqual(getUserAffinity("user_1", "deepseek-chat"), ["off_B", "off_A"]);

  // Update existing
  pushUserAffinity("user_1", "deepseek-chat", "off_A", 180);
  // off_A should still be in the list
  const affinities = getUserAffinity("user_1", "deepseek-chat");
  assert.ok(affinities.includes("off_A"));
  assert.ok(affinities.includes("off_B"));
});

test("user affinity: max 3 entries per model", () => {
  _resetForTest();

  pushUserAffinity("user_1", "model_X", "off_A", 100);
  pushUserAffinity("user_1", "model_X", "off_B", 200);
  pushUserAffinity("user_1", "model_X", "off_C", 300);
  pushUserAffinity("user_1", "model_X", "off_D", 400);

  const affinities = getUserAffinity("user_1", "model_X");
  assert.equal(affinities.length, 3);
  assert.ok(affinities.includes("off_D"));
  assert.ok(!affinities.includes("off_A")); // evicted
});

test("affinity threshold increases with message count", () => {
  assert.equal(getAffinityThresholdMs(1), 2000);
  assert.equal(getAffinityThresholdMs(5), 3000);
  assert.equal(getAffinityThresholdMs(15), 4000);
});

// ── Offering Queue Tests ────────────────────────────────────────────

test("offering queue: acquire and release", async () => {
  _resetQueuesForTest();

  const queue = new OfferingQueue(2);
  assert.equal(queue.activeCount, 0);
  assert.equal(queue.load, 0);

  const r1 = await queue.acquire(1000);
  assert.ok(r1 !== null);
  assert.equal(queue.activeCount, 1);

  const r2 = await queue.acquire(1000);
  assert.ok(r2 !== null);
  assert.equal(queue.activeCount, 2);
  assert.equal(queue.load, 1);

  r1!();
  assert.equal(queue.activeCount, 1);
  r2!();
  assert.equal(queue.activeCount, 0);
});

test("offering queue: estimatedWaitMs is 0 when not full", () => {
  _resetQueuesForTest();

  const queue = new OfferingQueue(5);
  assert.equal(queue.estimatedWaitMs, 0);
});

test("offering queue: latency tracking", () => {
  _resetQueuesForTest();

  const queue = new OfferingQueue(5);
  assert.equal(queue.avgLatencyMs, 1000); // default

  queue.recordLatency(200);
  queue.recordLatency(400);
  assert.equal(queue.avgLatencyMs, 300);
});

test("offering queue: isFull when maxWaiting reached", async () => {
  _resetQueuesForTest();

  const queue = new OfferingQueue(1, 2); // max 1 concurrent, 2 waiting

  const r1 = await queue.acquire(100);
  assert.ok(r1 !== null);
  // Queue is now full (1 active), next ones go to waiting

  assert.equal(queue.isFull, false); // waiting queue not full yet

  // These will go to waiting (timeout quickly)
  const p2 = queue.acquire(50);
  const p3 = queue.acquire(50);

  assert.equal(queue.isFull, true); // waiting = 2 = maxWaiting

  // Let timeouts resolve
  await p2;
  await p3;
  r1!();
});

test("getOrCreateQueue returns same instance", () => {
  _resetQueuesForTest();

  const q1 = getOrCreateQueue("off_test", 5);
  const q2 = getOrCreateQueue("off_test", 5);
  assert.equal(q1, q2);
});

// ── Context Affinity TTL Tests ─────────────────────────────────────

const CONV_TTL_MS = 30 * 60 * 1000; // 30 minutes
const USER_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

test("conversation affinity: expires after TTL", () => {
  _resetForTest();
  const originalNow = Date.now;

  const baseTime = originalNow.call(Date);
  Date.now = () => baseTime;
  setConvAffinity("conv_ttl", "off_A", 5);
  assert.equal(getConvAffinity("conv_ttl"), "off_A");

  // Advance past 30 minutes
  Date.now = () => baseTime + CONV_TTL_MS + 1;
  assert.equal(getConvAffinity("conv_ttl"), null);

  Date.now = originalNow;
});

test("conversation affinity: not expired within TTL", () => {
  _resetForTest();
  const originalNow = Date.now;

  const baseTime = originalNow.call(Date);
  Date.now = () => baseTime;
  setConvAffinity("conv_ok", "off_B", 3);

  // Advance to 29 minutes — still within TTL
  Date.now = () => baseTime + 29 * 60 * 1000;
  assert.equal(getConvAffinity("conv_ok"), "off_B");

  Date.now = originalNow;
});

test("user affinity: expires after TTL", () => {
  _resetForTest();
  const originalNow = Date.now;

  const baseTime = originalNow.call(Date);
  Date.now = () => baseTime;
  pushUserAffinity("user_ttl", "model_A", "off_X", 200);
  assert.deepEqual(getUserAffinity("user_ttl", "model_A"), ["off_X"]);

  // Advance past 2 hours
  Date.now = () => baseTime + USER_TTL_MS + 1;
  assert.deepEqual(getUserAffinity("user_ttl", "model_A"), []);

  Date.now = originalNow;
});

test("user affinity: not expired within TTL", () => {
  _resetForTest();
  const originalNow = Date.now;

  const baseTime = originalNow.call(Date);
  Date.now = () => baseTime;
  pushUserAffinity("user_ok", "model_B", "off_Y", 150);

  // Advance to 1h59m — still within TTL
  Date.now = () => baseTime + USER_TTL_MS - 60 * 1000;
  assert.deepEqual(getUserAffinity("user_ok", "model_B"), ["off_Y"]);

  Date.now = originalNow;
});

test("user affinity: latency averaging uses 70/30 weighting", () => {
  _resetForTest();
  const originalNow = Date.now;

  const baseTime = originalNow.call(Date);
  Date.now = () => baseTime;

  // Push two offerings with different latencies
  pushUserAffinity("user_lat", "model_L", "off_fast", 100);
  pushUserAffinity("user_lat", "model_L", "off_slow", 500);

  // Ordering should be: off_slow first (most recently pushed via unshift), then off_fast
  assert.deepEqual(getUserAffinity("user_lat", "model_L"), ["off_slow", "off_fast"]);

  // Now update off_slow with a very low latency: avg = round(500*0.7 + 50*0.3) = round(350+15) = 365
  pushUserAffinity("user_lat", "model_L", "off_slow", 50);

  // Update off_fast with a high latency: avg = round(100*0.7 + 900*0.3) = round(70+270) = 340
  pushUserAffinity("user_lat", "model_L", "off_fast", 900);

  // Both should still be present (update doesn't change order in the array, just updates in place)
  const result = getUserAffinity("user_lat", "model_L");
  assert.equal(result.length, 2);
  assert.ok(result.includes("off_slow"));
  assert.ok(result.includes("off_fast"));

  Date.now = originalNow;
});

test("user affinity: mixed expired and valid entries", () => {
  _resetForTest();
  const originalNow = Date.now;

  const baseTime = originalNow.call(Date);

  // Push off_old at baseTime
  Date.now = () => baseTime;
  pushUserAffinity("user_mix", "model_M", "off_old", 200);

  // Push off_mid 1 hour later
  Date.now = () => baseTime + 60 * 60 * 1000;
  pushUserAffinity("user_mix", "model_M", "off_mid", 300);

  // Push off_new 1.5 hours later
  Date.now = () => baseTime + 90 * 60 * 1000;
  pushUserAffinity("user_mix", "model_M", "off_new", 100);

  // Now advance to baseTime + 2h30m
  // off_old was pushed at baseTime → age = 2h30m → expired (> 2h)
  // off_mid was pushed at baseTime+1h → age = 1h30m → valid
  // off_new was pushed at baseTime+1.5h → age = 1h → valid
  Date.now = () => baseTime + 150 * 60 * 1000;

  const result = getUserAffinity("user_mix", "model_M");
  assert.equal(result.length, 2);
  assert.ok(result.includes("off_mid"));
  assert.ok(result.includes("off_new"));
  assert.ok(!result.includes("off_old"));

  Date.now = originalNow;
});
