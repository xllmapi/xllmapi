# xllmapi Productionization Execution Plan

## Summary

This plan prioritizes first-release production readiness over full platform redesign.

Release goals:

1. Stable Docker-based delivery.
2. Safe enough public deployment baseline.
3. Zero-downtime-friendly static asset upgrades.
4. Stronger startup validation and runtime observability.
5. Expanded tests on release-critical paths.

Deferred goals:

1. Optional browser cookie session support alongside bearer auth.
2. Password hash migration to `argon2id`.
3. Settlement outbox, retry worker, and reconciliation pipeline.

## Working Assumptions

1. The real runtime architecture is the current Node.js monolith: `platform-api` + `web` + Postgres + Redis.
2. Docker is the primary production deployment path.
3. Bearer auth remains the primary compatibility path for the first production hardening pass.
4. SQLite remains development-only and must not be silently used in production.

## Phase A: Build and Delivery

### Goals

1. Make Docker builds deterministic.
2. Make deploy failures stop the release.
3. Introduce release identifiers for future asset versioning.

### Changes

1. Rewrite the production Dockerfile to copy every required workspace:
   - `packages/logger`
   - `packages/shared-types`
   - `packages/core`
   - `apps/web`
   - `apps/platform-api`
2. Keep the runtime image lean and only copy compiled output plus required runtime files.
3. Add `XLLMAPI_RELEASE_ID` support.
4. Harden `scripts/deploy.sh`:
   - no `npm ci --omit=dev` before build
   - correct PM2 config path if PM2 remains supported
   - fail hard on health-check failure
5. Add CI validation for container build and runtime smoke.

### Acceptance

1. `npm run build` passes.
2. Docker image builds successfully.
3. Container starts and passes `/healthz`.
4. Deploy script exits non-zero on unhealthy release.

## Phase B: Must-Have Security Hardening

### Goals

1. Close high-risk production leaks.
2. Add basic abuse protection.
3. Avoid unsafe request parsing defaults.

### Changes

1. Disable `/internal/debug/state` in production.
2. Add rate limits for:
   - `POST /v1/auth/request-code`
   - `POST /v1/auth/verify-code`
   - `POST /v1/auth/login`
3. Add request body size limits.
4. Make `POST /v1/auth/logout` actually invalidate the current session.
5. Require explicit CORS allowlist in production.
6. Add a baseline CSP and stricter security headers.
7. Stop returning raw internal error messages to clients.

### Acceptance

1. Auth abuse endpoints are rate limited.
2. Logout invalidates the active session.
3. Oversized bodies are rejected.
4. Debug state is not exposed in production.
5. Browser security headers are present.

## Phase C: Zero-Downtime Upgrade Essentials

### Goals

1. Prevent white-screen failures during frontend upgrades.
2. Separate liveness from readiness.
3. Make drain-aware rollout possible.

### Changes

1. Adjust static file serving:
   - page routes fall back to `index.html`
   - missing asset files return `404`
2. Add release-aware static asset paths using `XLLMAPI_RELEASE_ID`.
3. Preserve recent release assets to keep old pages working during rollout.
4. Add `/readyz`.
5. Add `/version` for diagnostics.
6. Extend graceful shutdown with explicit draining behavior.

### Acceptance

1. Missing JS/CSS asset requests return `404`.
2. `/readyz` goes unhealthy while draining.
3. Old pages can still fetch old assets during rollout.

## Phase D: Production Config Validation and Observability

### Goals

1. Fail fast on dangerous production misconfiguration.
2. Replace ad hoc metrics with scrape-friendly output.

### Changes

1. Production startup validation must require:
   - `XLLMAPI_DB_DRIVER=postgres`
   - `DATABASE_URL`
   - `REDIS_URL`
   - `XLLMAPI_CORS_ORIGINS`
   - valid numeric env values
2. Prevent production fallback to SQLite.
3. Expose Prometheus-style `/metrics`.
4. Normalize failure handling for uncaught exceptions and rejections.

### Acceptance

1. Invalid production config prevents startup.
2. `/metrics` is scrapeable.
3. Runtime state does not continue silently under broken config.

## Phase E: Chat Guardrails and Lightweight Settlement Hardening

### Goals

1. Ensure streaming and non-streaming requests share the same protections.
2. Make settlement failures visible and traceable.

### Changes

1. Reuse a shared guard path for chat:
   - auth
   - rate limit
   - wallet check
   - offering resolution
2. Fix the streaming conversation route so it cannot bypass wallet/rate controls.
3. Add explicit settlement status tracking.
4. Improve metrics and logs around settlement failure.

### Acceptance

1. Streaming requests cannot bypass rate limits or wallet checks.
2. Settlement failure is visible in logs, metrics, and stored request state.

## Phase F: Tests and Release Verification

### Goals

1. Expand test coverage around release-critical functionality.
2. Add stronger provider/model compatibility tests.

### Test Expansion

1. Unit tests:
   - config validation
   - rate limiting
   - request body size enforcement
   - static asset routing behavior
2. Integration tests:
   - auth endpoint rate limits
   - logout invalidation
   - readyz/drain behavior
   - stream/non-stream guard consistency
3. E2E tests:
   - existing MVP flow
   - existing sharing flow when enabled
   - new release-safe asset compatibility scenario

### Target Model Coverage

Protocol and adapter tests should cover:

1. `gpt-4o-mini`
2. `gpt-4o`
3. `deepseek-chat`
4. `deepseek-reasoner`
5. `claude-sonnet-4-20250514`
6. `moonshot-v1-8k`
7. `moonshot-v1-32k`
8. `kimi-for-coding`
9. `MiniMax-M2.7`

## Git Strategy

Planned commit sequence:

1. `docs: add production readiness execution plan`
2. `build: fix docker delivery path and release script`
3. `security: harden auth endpoints, body limits, and debug exposure`
4. `runtime: add readiness and versioned static asset serving`
5. `runtime: enforce production config validation and prometheus metrics`
6. `billing: unify chat guardrails and add settlement status visibility`
7. `test: expand release-critical integration and e2e coverage`
8. `docs: align architecture and deployment docs with implemented production path`

## Deferred Roadmap

These items stay in scope, but do not block the first hardened release:

1. Cookie session support alongside bearer auth.
2. Password migration to `argon2id`.
3. Settlement outbox and retry worker.
4. Reconciliation jobs and automated financial repair flows.
