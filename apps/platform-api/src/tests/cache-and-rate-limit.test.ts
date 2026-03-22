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
