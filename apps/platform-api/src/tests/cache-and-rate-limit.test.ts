import test from "node:test";
import assert from "node:assert/strict";

import { cacheService } from "../cache.js";
import { consumeRateLimit } from "../rate-limit.js";

test("in-memory rate limiter blocks after limit", () => {
  const first = consumeRateLimit({
    key: "test:rate-limit",
    limit: 2,
    windowMs: 1_000
  });
  const second = consumeRateLimit({
    key: "test:rate-limit",
    limit: 2,
    windowMs: 1_000
  });
  const third = consumeRateLimit({
    key: "test:rate-limit",
    limit: 2,
    windowMs: 1_000
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
});

test("cache service stores and returns idempotent response without redis", async () => {
  const key = `test:idempotent:${Date.now()}`;
  const payload = JSON.stringify({ ok: true, requestId: "req_test" });

  await cacheService.setCachedResponse({
    key,
    value: payload,
    ttlSeconds: 60
  });

  const cached = await cacheService.getCachedResponse(key);
  assert.ok(cached);
  assert.equal(cached?.value, payload);
  assert.ok(cached?.source === "memory" || cached?.source === "redis", `expected memory or redis, got ${cached?.source}`);
});

test("rate limiter: different keys are independent", () => {
  const keyA = `test:independent-a:${Date.now()}`;
  const keyB = `test:independent-b:${Date.now()}`;

  const resultA = consumeRateLimit({ key: keyA, limit: 1, windowMs: 10_000 });
  const resultB = consumeRateLimit({ key: keyB, limit: 1, windowMs: 10_000 });

  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
});

test("rate limiter: returns correct remaining count", () => {
  const key = `test:remaining:${Date.now()}`;

  const r1 = consumeRateLimit({ key, limit: 3, windowMs: 10_000 });
  const r2 = consumeRateLimit({ key, limit: 3, windowMs: 10_000 });
  const r3 = consumeRateLimit({ key, limit: 3, windowMs: 10_000 });

  assert.equal(r1.remaining, 2);
  assert.equal(r2.remaining, 1);
  assert.equal(r3.remaining, 0);
});

test("rate limiter: window resets after expiry", async () => {
  const key = `test:window-reset:${Date.now()}`;

  const r1 = consumeRateLimit({ key, limit: 1, windowMs: 1 });
  assert.equal(r1.ok, true);

  const r2 = consumeRateLimit({ key, limit: 1, windowMs: 1 });
  assert.equal(r2.ok, false);

  await new Promise((resolve) => setTimeout(resolve, 5));

  const r3 = consumeRateLimit({ key, limit: 1, windowMs: 1 });
  assert.equal(r3.ok, true);
});

test("rate limiter: exact boundary - limit=5, 5th request passes, 6th fails", () => {
  const key = `test:boundary:${Date.now()}`;
  const opts = { key, limit: 5, windowMs: 10_000 };

  for (let i = 0; i < 4; i++) {
    assert.equal(consumeRateLimit(opts).ok, true);
  }

  const fifth = consumeRateLimit(opts);
  assert.equal(fifth.ok, true);
  assert.equal(fifth.remaining, 0);

  const sixth = consumeRateLimit(opts);
  assert.equal(sixth.ok, false);
  assert.equal(sixth.remaining, 0);
});

test("cache: different keys stored independently", async () => {
  const keyA = `test:cache-indep-a:${Date.now()}`;
  const keyB = `test:cache-indep-b:${Date.now()}`;

  await cacheService.setCachedResponse({ key: keyA, value: "value-a", ttlSeconds: 60 });
  await cacheService.setCachedResponse({ key: keyB, value: "value-b", ttlSeconds: 60 });

  const cachedA = await cacheService.getCachedResponse(keyA);
  const cachedB = await cacheService.getCachedResponse(keyB);

  assert.equal(cachedA?.value, "value-a");
  assert.equal(cachedB?.value, "value-b");
});

test("cache: TTL expiry returns null", async () => {
  const key = `test:cache-ttl:${Date.now()}`;

  await cacheService.setCachedResponse({ key, value: "ephemeral", ttlSeconds: 0 });

  await new Promise((resolve) => setTimeout(resolve, 5));

  const cached = await cacheService.getCachedResponse(key);
  assert.equal(cached, null);
});
