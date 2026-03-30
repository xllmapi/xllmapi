import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isRetryableError,
  isRetryableStatus,
  withRetry,
} from "../retry.js";

describe("isRetryableError", () => {
  it("returns true for TypeError", () => {
    assert.equal(isRetryableError(new TypeError("fetch failed")), true);
  });

  it("returns false for regular Error", () => {
    assert.equal(isRetryableError(new Error("something broke")), false);
  });

  it("returns false for DOMException AbortError", () => {
    const err = new DOMException("Aborted", "AbortError");
    assert.equal(isRetryableError(err), false);
  });

  it("returns false for null", () => {
    assert.equal(isRetryableError(null), false);
  });
});

describe("isRetryableStatus", () => {
  it("returns true for 429", () => {
    assert.equal(isRetryableStatus(429), true);
  });

  it("returns true for 500", () => {
    assert.equal(isRetryableStatus(500), true);
  });

  it("returns true for 502", () => {
    assert.equal(isRetryableStatus(502), true);
  });

  it("returns false for 200", () => {
    assert.equal(isRetryableStatus(200), false);
  });

  it("returns false for 401", () => {
    assert.equal(isRetryableStatus(401), false);
  });
});

describe("withRetry", () => {
  it("succeeds on first try", async () => {
    let callCount = 0;
    const result = await withRetry(async () => {
      callCount++;
      return "ok";
    }, { baseDelayMs: 10 });

    assert.equal(result, "ok");
    assert.equal(callCount, 1);
  });

  it("retries on TypeError and succeeds on second attempt", async () => {
    let callCount = 0;
    const result = await withRetry(async () => {
      callCount++;
      if (callCount === 1) throw new TypeError("fetch failed");
      return "recovered";
    }, { baseDelayMs: 10 });

    assert.equal(result, "recovered");
    assert.equal(callCount, 2);
  });

  it("exhausts all attempts and throws last error", async () => {
    let callCount = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            callCount++;
            throw new TypeError("network error");
          },
          { maxAttempts: 3, baseDelayMs: 10 }
        ),
      (err: unknown) => {
        assert.ok(err instanceof TypeError);
        assert.equal((err as TypeError).message, "network error");
        return true;
      }
    );
    assert.equal(callCount, 3);
  });

  it("does not retry non-retryable errors", async () => {
    let callCount = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            callCount++;
            throw new Error("not retryable");
          },
          { maxAttempts: 3, baseDelayMs: 10 }
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as Error).message, "not retryable");
        return true;
      }
    );
    assert.equal(callCount, 1);
  });
});
