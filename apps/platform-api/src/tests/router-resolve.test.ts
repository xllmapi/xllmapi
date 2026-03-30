import test from "node:test";
import assert from "node:assert/strict";

import type { CandidateOffering } from "@xllmapi/shared-types";
import { resolveOfferings, routeRequest } from "../core/router.js";
import { platformService } from "../services/platform-service.js";
import { recordFailure, resetBreaker } from "@xllmapi/core";
import { _resetQueuesForTest } from "../core/offering-queue.js";

// ── Helpers ────────────────────────────────────────────────────────

function makeOffering(overrides: Partial<CandidateOffering> & { offeringId: string }): CandidateOffering {
  return {
    ownerUserId: "owner_1",
    providerType: "openai_compatible",
    credentialId: "cred_1",
    realModel: "deepseek-chat",
    pricingMode: "fixed_price",
    successRate1h: 0.99,
    p95LatencyMs1h: 500,
    recentErrorRate10m: 0,
    enabled: true,
    ...overrides,
  };
}

const platformOfferings: CandidateOffering[] = [
  makeOffering({ offeringId: "platform_off_1", executionMode: "platform", realModel: "deepseek-chat" }),
  makeOffering({ offeringId: "platform_off_2", executionMode: "platform", realModel: "claude-3.5-sonnet" }),
  makeOffering({ offeringId: "node_off_1", executionMode: "node", realModel: "deepseek-chat", nodeId: "node_1" }),
];

const userPoolOfferings: CandidateOffering[] = [
  makeOffering({ offeringId: "user_off_1", executionMode: "platform", realModel: "deepseek-chat" }),
];

// ── resolveOfferings: model-level fallback ─────────────────────────

test("resolveOfferings: user with connection pool, model in pool → uses pool offerings", async (t) => {
  t.mock.method(platformService, "listConnectionPool", async () => [{ offeringId: "user_off_1" }]);
  t.mock.method(platformService, "findUserOfferingsForModel", async () => userPoolOfferings);
  t.mock.method(platformService, "getUserModelConfig", async () => null);

  const result = await resolveOfferings("deepseek-chat", "user_1");
  assert.equal(result.length, 1);
  assert.equal(result[0].offeringId, "user_off_1");
});

test("resolveOfferings: user with connection pool, model NOT in pool → fallback to platform offerings", async (t) => {
  t.mock.method(platformService, "listConnectionPool", async () => [{ offeringId: "user_off_1" }]);
  t.mock.method(platformService, "findUserOfferingsForModel", async () => []);
  t.mock.method(platformService, "findOfferingsForModel", async () => platformOfferings);
  t.mock.method(platformService, "getUserModelConfig", async () => null);

  const result = await resolveOfferings("claude-3.5-sonnet", "user_1");
  // Should fallback to platform offerings, excluding node type
  assert.ok(result.length > 0);
  assert.ok(result.every(o => o.executionMode !== "node"));
});

test("resolveOfferings: user with empty connection pool → uses all platform offerings (no node)", async (t) => {
  t.mock.method(platformService, "listConnectionPool", async () => []);
  t.mock.method(platformService, "findOfferingsForModel", async () => platformOfferings);
  t.mock.method(platformService, "getUserModelConfig", async () => null);

  const result = await resolveOfferings("deepseek-chat", "user_1");
  assert.ok(result.length > 0);
  assert.ok(result.every(o => o.executionMode !== "node"));
});

test("resolveOfferings: no userId → uses all platform offerings (no node)", async (t) => {
  t.mock.method(platformService, "findOfferingsForModel", async () => platformOfferings);

  const result = await resolveOfferings("deepseek-chat");
  assert.ok(result.length > 0);
  assert.ok(result.every(o => o.executionMode !== "node"));
});

// ── filterAvailable / routeRequest: cooldown behavior ──────────────

test("routeRequest: single offering in cooldown → throws instead of forcing request", async (t) => {
  _resetQueuesForTest();

  const singleOffering = [makeOffering({ offeringId: "cooldown_off_1" })];

  t.mock.method(platformService, "listConnectionPool", async () => []);
  t.mock.method(platformService, "findOfferingsForModel", async () => singleOffering);
  t.mock.method(platformService, "getUserModelConfig", async () => null);

  // Trip the circuit breaker: 3 transient failures → open state
  recordFailure("cooldown_off_1", "transient");
  recordFailure("cooldown_off_1", "transient");
  recordFailure("cooldown_off_1", "transient");

  await assert.rejects(
    () => routeRequest({
      logicalModel: "deepseek-chat",
      userId: "user_1",
      requestId: "req_1",
      messageCount: 1,
    }),
    { message: /all in cooldown/ }
  );

  // Cleanup
  resetBreaker("cooldown_off_1");
});

test("routeRequest: multiple offerings, one in cooldown → routes to available one", async (t) => {
  _resetQueuesForTest();

  const offerings = [
    makeOffering({ offeringId: "cool_off_a" }),
    makeOffering({ offeringId: "cool_off_b" }),
  ];

  t.mock.method(platformService, "listConnectionPool", async () => []);
  t.mock.method(platformService, "findOfferingsForModel", async () => offerings);
  t.mock.method(platformService, "getUserModelConfig", async () => null);

  // Trip breaker for offering A only
  recordFailure("cool_off_a", "transient");
  recordFailure("cool_off_a", "transient");
  recordFailure("cool_off_a", "transient");

  const result = await routeRequest({
    logicalModel: "deepseek-chat",
    userId: "user_1",
    requestId: "req_2",
    messageCount: 1,
  });

  assert.equal(result.offering.offeringId, "cool_off_b");
  result.release();

  // Cleanup
  resetBreaker("cool_off_a");
  resetBreaker("cool_off_b");
});

test("routeRequest: offering in half-open state → allowed as probe", async (t) => {
  _resetQueuesForTest();

  const offerings = [makeOffering({ offeringId: "halfopen_off_1" })];

  t.mock.method(platformService, "listConnectionPool", async () => []);
  t.mock.method(platformService, "findOfferingsForModel", async () => offerings);
  t.mock.method(platformService, "getUserModelConfig", async () => null);

  // Trip breaker then simulate cooldown elapsed (half-open)
  recordFailure("halfopen_off_1", "transient");
  recordFailure("halfopen_off_1", "transient");
  recordFailure("halfopen_off_1", "transient");

  // Manually set lastFailureAt far in the past to trigger half-open
  const { getBreakerState: getState } = await import("@xllmapi/core");
  const state = getState("halfopen_off_1");
  state.lastFailureAt = Date.now() - 600_000; // 10 min ago, well past cooldown

  const result = await routeRequest({
    logicalModel: "deepseek-chat",
    userId: "user_1",
    requestId: "req_3",
    messageCount: 1,
  });

  assert.equal(result.offering.offeringId, "halfopen_off_1");
  result.release();

  // Cleanup
  resetBreaker("halfopen_off_1");
});
