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
