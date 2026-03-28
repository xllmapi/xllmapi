// ── Per-Offering Request Queue ───────────────────────────────────────
// Each offering maintains its own bounded queue with latency tracking.

const DEFAULT_MAX_CONCURRENCY = 10;
const DEFAULT_MAX_WAITING = 20;
const LATENCY_HISTORY_SIZE = 20;
const DEFAULT_LATENCY_MS = 1000;

export class OfferingQueue {
  private active = 0;
  private waiting: Array<{
    resolve: (release: () => void) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private maxConcurrency: number;
  private maxWaiting: number;
  private latencyHistory: number[] = [];

  constructor(maxConcurrency = DEFAULT_MAX_CONCURRENCY, maxWaiting = DEFAULT_MAX_WAITING) {
    this.maxConcurrency = Math.max(maxConcurrency, 1);
    this.maxWaiting = maxWaiting;
  }

  get load(): number {
    return this.active / this.maxConcurrency;
  }

  get pending(): number { return this.waiting.length; }
  get activeCount(): number { return this.active; }
  get isFull(): boolean { return this.waiting.length >= this.maxWaiting; }

  get avgLatencyMs(): number {
    if (this.latencyHistory.length === 0) return DEFAULT_LATENCY_MS;
    return this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
  }

  get estimatedWaitMs(): number {
    if (this.active < this.maxConcurrency) return 0;
    return (this.waiting.length + 1) * this.avgLatencyMs;
  }

  get estimatedTotalMs(): number {
    return this.estimatedWaitMs + this.avgLatencyMs;
  }

  recordLatency(ms: number): void {
    this.latencyHistory.push(ms);
    if (this.latencyHistory.length > LATENCY_HISTORY_SIZE) this.latencyHistory.shift();
  }

  async acquire(timeoutMs: number): Promise<(() => void) | null> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return () => this.release();
    }

    if (this.isFull) return null;

    return new Promise<(() => void) | null>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiting.findIndex(w => w.timer === timer);
        if (idx !== -1) this.waiting.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      this.waiting.push({
        resolve: (release) => { clearTimeout(timer); resolve(release); },
        timer
      });
    });
  }

  private release(): void {
    this.active--;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      this.active++;
      next.resolve(() => this.release());
    }
  }
}

// ── Global queue map ────────────────────────────────────────────────

const queues = new Map<string, OfferingQueue>();

export function getOrCreateQueue(offeringId: string, maxConcurrency?: number): OfferingQueue {
  let q = queues.get(offeringId);
  if (!q) {
    q = new OfferingQueue(maxConcurrency);
    queues.set(offeringId, q);
  }
  return q;
}

// ── Test helpers ────────────────────────────────────────────────────

export function _resetQueuesForTest(): void {
  queues.clear();
}
