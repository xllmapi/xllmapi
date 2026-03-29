/**
 * Three-tier circuit breaker with exponential cooldown.
 *
 * Error classes:
 *   transient — network timeout, 500, 429. Threshold: 3 failures → open. Cooldown: 30s base, 10min max.
 *   degraded  — 403 quota exhausted. Threshold: 1 failure → open. Cooldown: 10min base, 24h max.
 *   fatal     — 401 key invalid, 403 UA rejected. Threshold: 1 failure → disabled (no auto-recovery).
 *
 * States: closed → open → half-open → closed (on success) or open (on failure, cooldown doubles)
 *         closed → disabled (fatal error, only manual reset)
 */

export type ErrorClass = "transient" | "degraded" | "fatal";

export interface BreakerState {
  failures: number;
  lastFailureAt: number;
  state: "closed" | "open" | "half-open" | "disabled";
  errorClass: ErrorClass | null;
  cooldownMs: number;
  consecutiveOpenCount: number;
  firstDegradedAt: number;
  lastErrorMessage: string;
  autoDisabled: boolean;
}

// ── Config ──

const TRANSIENT_THRESHOLD = 3;
const TRANSIENT_BASE_COOLDOWN_MS = 30_000;     // 30s
const TRANSIENT_MAX_COOLDOWN_MS = 600_000;     // 10min

const DEGRADED_BASE_COOLDOWN_MS = 600_000;     // 10min
const DEGRADED_MAX_COOLDOWN_MS = 86_400_000;   // 24h

const AUTO_DISABLE_COUNT = 10;
const AUTO_DISABLE_DURATION_MS = 7 * 24 * 3600 * 1000; // 7 days

// ── State store ──

const breakers = new Map<string, BreakerState>();

function getOrCreate(offeringId: string): BreakerState {
  let s = breakers.get(offeringId);
  if (!s) {
    s = {
      failures: 0,
      lastFailureAt: 0,
      state: "closed",
      errorClass: null,
      cooldownMs: 0,
      consecutiveOpenCount: 0,
      firstDegradedAt: 0,
      lastErrorMessage: "",
      autoDisabled: false,
    };
    breakers.set(offeringId, s);
  }
  return s;
}

// ── Public API ──

export function isAvailable(offeringId: string): boolean {
  const s = getOrCreate(offeringId);
  if (s.state === "closed") return true;
  if (s.state === "disabled") return false;
  if (s.state === "open") {
    if (Date.now() - s.lastFailureAt >= s.cooldownMs) {
      s.state = "half-open";
      return true;
    }
    return false;
  }
  // half-open: allow one probe
  return true;
}

/** Health weight for offering selection: 1.0 = healthy, 0.3 = probing, 0.0 = unavailable */
export function getHealthWeight(offeringId: string): number {
  const s = getOrCreate(offeringId);
  switch (s.state) {
    case "closed": return 1.0;
    case "half-open": return 0.3;
    case "open":
    case "disabled":
      return 0.0;
  }
}

export function recordSuccess(offeringId: string): void {
  const s = getOrCreate(offeringId);
  s.failures = 0;
  s.state = "closed";
  s.errorClass = null;
  s.cooldownMs = 0;
  s.consecutiveOpenCount = 0;
  s.firstDegradedAt = 0;
  s.lastErrorMessage = "";
}

export function recordFailure(offeringId: string, errorClass: ErrorClass = "transient", errorMessage = ""): void {
  const s = getOrCreate(offeringId);
  s.failures++;
  s.lastFailureAt = Date.now();
  s.errorClass = errorClass;
  s.lastErrorMessage = errorMessage.slice(0, 500);

  switch (errorClass) {
    case "transient":
      if (s.failures >= TRANSIENT_THRESHOLD) {
        s.state = "open";
        s.consecutiveOpenCount++;
        s.cooldownMs = Math.min(
          TRANSIENT_BASE_COOLDOWN_MS * Math.pow(2, s.consecutiveOpenCount - 1),
          TRANSIENT_MAX_COOLDOWN_MS
        );
      }
      break;

    case "degraded":
      s.state = "open";
      s.consecutiveOpenCount++;
      if (!s.firstDegradedAt) s.firstDegradedAt = Date.now();
      s.cooldownMs = Math.min(
        DEGRADED_BASE_COOLDOWN_MS * Math.pow(2, s.consecutiveOpenCount - 1),
        DEGRADED_MAX_COOLDOWN_MS
      );
      break;

    case "fatal":
      s.state = "disabled";
      s.cooldownMs = 0;
      break;
  }
}

/** Check if an offering should be auto-disabled (degraded too long). Returns true if just disabled. */
export function checkAutoDisable(offeringId: string): boolean {
  const s = getOrCreate(offeringId);
  if (s.errorClass !== "degraded") return false;
  if (s.consecutiveOpenCount >= AUTO_DISABLE_COUNT
    && s.firstDegradedAt > 0
    && Date.now() - s.firstDegradedAt >= AUTO_DISABLE_DURATION_MS) {
    s.state = "disabled";
    s.autoDisabled = true;
    return true;
  }
  return false;
}

/** Get breaker state for admin inspection */
export function getBreakerState(offeringId: string): BreakerState {
  return getOrCreate(offeringId);
}

/** Get all breaker states (for admin listing) */
export function getAllBreakerStates(): Map<string, BreakerState> {
  return breakers;
}

/** Manual reset by admin or owner */
export function resetBreaker(offeringId: string): void {
  breakers.delete(offeringId);
}
