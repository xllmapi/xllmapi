import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConcurrencyLimiter } from "../concurrency-limiter.js";

describe("ConcurrencyLimiter", () => {
  it("acquire succeeds when below max", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const release = await limiter.acquire();
    assert.equal(typeof release, "function");
    release();
  });

  it("acquire queues when at max capacity", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const release1 = await limiter.acquire();

    let secondAcquired = false;
    const p2 = limiter.acquire().then((r) => {
      secondAcquired = true;
      return r;
    });

    // Give microtasks a chance to flush
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(secondAcquired, false, "second acquire should be queued");

    release1();
    const release2 = await p2;
    assert.equal(secondAcquired, true, "second acquire should resolve after release");
    release2();
  });

  it("release wakes queued waiters", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const release1 = await limiter.acquire();

    let woken = false;
    const p2 = limiter.acquire().then((r) => {
      woken = true;
      return r;
    });

    assert.equal(woken, false);
    release1();

    const release2 = await p2;
    assert.equal(woken, true);
    release2();
  });

  it("FIFO order for queued requests", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: number[] = [];

    const release1 = await limiter.acquire();

    const p2 = limiter.acquire().then((r) => {
      order.push(2);
      return r;
    });
    const p3 = limiter.acquire().then((r) => {
      order.push(3);
      return r;
    });

    // Release first slot — should wake #2
    release1();
    const release2 = await p2;

    // Release second slot — should wake #3
    release2();
    const release3 = await p3;

    assert.deepEqual(order, [2, 3], "waiters should be woken in FIFO order");
    release3();
  });

  it("double release is safe", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const release = await limiter.acquire();

    release();
    release(); // should be a no-op

    // Limiter should still work correctly after double release
    const r2 = await limiter.acquire();
    r2();
  });

  it("concurrent acquires respect max", async () => {
    const max = 2;
    const limiter = new ConcurrencyLimiter(max);
    let activeCount = 0;
    let maxObserved = 0;

    const runTask = async () => {
      const release = await limiter.acquire();
      activeCount++;
      if (activeCount > maxObserved) maxObserved = activeCount;
      // Simulate async work
      await new Promise((r) => setTimeout(r, 5));
      activeCount--;
      release();
    };

    // Launch 6 concurrent tasks with max=2
    await Promise.all(
      Array.from({ length: 6 }, () => runTask()),
    );

    assert.equal(maxObserved, max, `at most ${max} tasks should run concurrently`);
    assert.equal(activeCount, 0, "all tasks should have completed");
  });
});
