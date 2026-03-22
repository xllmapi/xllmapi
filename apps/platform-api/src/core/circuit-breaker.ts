const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;

interface BreakerState {
  failures: number;
  lastFailureAt: number;
  state: "closed" | "open" | "half-open";
}

const breakers = new Map<string, BreakerState>();

function getOrCreate(offeringId: string): BreakerState {
  let s = breakers.get(offeringId);
  if (!s) {
    s = { failures: 0, lastFailureAt: 0, state: "closed" };
    breakers.set(offeringId, s);
  }
  return s;
}

export function isAvailable(offeringId: string): boolean {
  const s = getOrCreate(offeringId);
  if (s.state === "closed") return true;
  if (s.state === "open") {
    if (Date.now() - s.lastFailureAt >= COOLDOWN_MS) {
      s.state = "half-open";
      return true;
    }
    return false;
  }
  // half-open: allow one probe
  return true;
}

export function recordSuccess(offeringId: string): void {
  const s = getOrCreate(offeringId);
  s.failures = 0;
  s.state = "closed";
}

export function recordFailure(offeringId: string): void {
  const s = getOrCreate(offeringId);
  s.failures++;
  s.lastFailureAt = Date.now();
  if (s.failures >= FAILURE_THRESHOLD) {
    s.state = "open";
  }
}
