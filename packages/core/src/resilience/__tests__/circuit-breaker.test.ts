import assert from "node:assert/strict";
import test from "node:test";

import {
  isAvailable, recordSuccess, recordFailure, resetBreaker,
  getBreakerState, getHealthWeight, checkAutoDisable,
} from "../circuit-breaker.js";

const ID = "test-offering-" + Date.now();
const fresh = () => { resetBreaker(ID); return ID; };

// ── Transient errors ──

test("transient: stays closed below threshold", () => {
  const id = fresh();
  recordFailure(id, "transient", "timeout");
  recordFailure(id, "transient", "timeout");
  assert.equal(getBreakerState(id).state, "closed");
  assert.equal(isAvailable(id), true);
});

test("transient: opens after 3 failures", () => {
  const id = fresh();
  recordFailure(id, "transient", "timeout");
  recordFailure(id, "transient", "timeout");
  recordFailure(id, "transient", "timeout");
  assert.equal(getBreakerState(id).state, "open");
  assert.equal(isAvailable(id), false);
  assert.equal(getHealthWeight(id), 0.0);
});

test("transient: cooldown starts at 30s", () => {
  const id = fresh();
  for (let i = 0; i < 3; i++) recordFailure(id, "transient");
  assert.equal(getBreakerState(id).cooldownMs, 30_000);
});

test("transient: cooldown doubles on repeated open", () => {
  const id = fresh();
  for (let i = 0; i < 3; i++) recordFailure(id, "transient");
  assert.equal(getBreakerState(id).cooldownMs, 30_000);
  // Simulate half-open probe failure
  recordSuccess(id);
  for (let i = 0; i < 3; i++) recordFailure(id, "transient");
  // consecutiveOpenCount resets on success, so it's 1 again
  assert.equal(getBreakerState(id).consecutiveOpenCount, 1);
});

// ── Degraded errors ──

test("degraded: opens immediately on first failure", () => {
  const id = fresh();
  recordFailure(id, "degraded", "quota exhausted");
  assert.equal(getBreakerState(id).state, "open");
  assert.equal(isAvailable(id), false);
});

test("degraded: cooldown starts at 10 minutes", () => {
  const id = fresh();
  recordFailure(id, "degraded", "quota");
  assert.equal(getBreakerState(id).cooldownMs, 600_000);
});

test("degraded: cooldown doubles each consecutive open", () => {
  const id = fresh();
  recordFailure(id, "degraded", "quota");
  assert.equal(getBreakerState(id).cooldownMs, 600_000); // 10min
  // Simulate: cooldown passes, half-open probe fails again
  const s = getBreakerState(id);
  s.lastFailureAt = Date.now() - 700_000; // force past cooldown
  assert.equal(isAvailable(id), true); // half-open
  assert.equal(getBreakerState(id).state, "half-open");
  recordFailure(id, "degraded", "still quota");
  assert.equal(getBreakerState(id).cooldownMs, 1_200_000); // 20min
});

test("degraded: cooldown capped at 24h", () => {
  const id = fresh();
  // Simulate many consecutive degraded failures
  for (let i = 0; i < 20; i++) recordFailure(id, "degraded", "quota");
  assert.ok(getBreakerState(id).cooldownMs <= 86_400_000);
});

// ── Fatal errors ──

test("fatal: disables immediately", () => {
  const id = fresh();
  recordFailure(id, "fatal", "invalid key");
  assert.equal(getBreakerState(id).state, "disabled");
  assert.equal(isAvailable(id), false);
  assert.equal(getHealthWeight(id), 0.0);
});

test("fatal: does not auto-recover", () => {
  const id = fresh();
  recordFailure(id, "fatal", "401");
  const s = getBreakerState(id);
  s.lastFailureAt = Date.now() - 999_999_999; // way past any cooldown
  assert.equal(isAvailable(id), false); // still disabled
});

// ── Recovery ──

test("success resets everything", () => {
  const id = fresh();
  recordFailure(id, "degraded", "quota");
  assert.equal(getBreakerState(id).state, "open");
  recordSuccess(id);
  assert.equal(getBreakerState(id).state, "closed");
  assert.equal(getBreakerState(id).failures, 0);
  assert.equal(getBreakerState(id).consecutiveOpenCount, 0);
});

test("manual reset clears state", () => {
  const id = fresh();
  recordFailure(id, "fatal", "key invalid");
  assert.equal(getBreakerState(id).state, "disabled");
  resetBreaker(id);
  assert.equal(getBreakerState(id).state, "closed");
  assert.equal(isAvailable(id), true);
});

// ── Half-open ──

test("half-open: weight is 0.3", () => {
  const id = fresh();
  for (let i = 0; i < 3; i++) recordFailure(id, "transient");
  const s = getBreakerState(id);
  s.lastFailureAt = Date.now() - 40_000; // past 30s cooldown
  assert.equal(isAvailable(id), true);
  assert.equal(getBreakerState(id).state, "half-open");
  assert.equal(getHealthWeight(id), 0.3);
});

// ── Auto-disable ──

test("checkAutoDisable: does not trigger below thresholds", () => {
  const id = fresh();
  for (let i = 0; i < 5; i++) recordFailure(id, "degraded");
  assert.equal(checkAutoDisable(id), false);
});

test("checkAutoDisable: triggers at 10 failures + 7 days", () => {
  const id = fresh();
  for (let i = 0; i < 10; i++) recordFailure(id, "degraded");
  const s = getBreakerState(id);
  s.firstDegradedAt = Date.now() - 8 * 24 * 3600 * 1000; // 8 days ago
  assert.equal(checkAutoDisable(id), true);
  assert.equal(getBreakerState(id).state, "disabled");
  assert.equal(getBreakerState(id).autoDisabled, true);
});
