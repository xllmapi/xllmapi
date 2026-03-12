# xllmapi Launch Readiness (2026-03-11)

## Current status

- Platform TypeScript build: PASS
- Platform tests: PASS (2/2)
- Web static routes: PASS (`/`, `/market`, `/docs`, `/auth`, `/app`, `/admin`, `/u/:handle`)
- Auth/session/invitation/admin/public APIs (Postgres + Redis): PASS via smoke test
- Chat completion end-to-end (`/v1/chat/completions`): PASS with DeepSeek credential

## What was verified

With local process mode:

- `XLLMAPI_DB_DRIVER=postgres`
- `DATABASE_URL=postgresql://xllmapi:xllmapi@127.0.0.1:5432/xllmapi`
- `REDIS_URL=redis://127.0.0.1:6379`

Verified endpoints:

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/auth/request-code`
- `POST /v1/auth/verify-code`
- `GET /v1/me`
- `GET /v1/me/invitation-stats`
- `GET /v1/invitations`
- `POST /v1/invitations` (returns `201` on create)
- `GET /v1/usage/supply`
- `GET /v1/usage/consumption`
- `GET /v1/admin/users`
- `GET /v1/admin/invitations`
- `GET /v1/admin/usage`
- `GET /v1/admin/market/summary`
- `GET /v1/public/users/:handle`
- `GET /v1/public/users/:handle/offerings`

## Production gaps before go-live

1. Provider availability is configuration-dependent.
- DeepSeek route has been validated with a real key and returns 200.
- Other seeded demo routes still depend on runtime env vars (for example `OPENAI_API_KEY`) and may return 502 if not configured.

2. Docker build path for core service is blocked by network/DNS in current host.
- `core-router-executor` image build fails when `apt-get` resolves Ubuntu package hosts.
- Not an app logic bug, but deployment pipeline blocker in this environment.

3. Provider credential quality gates need stricter preflight.
- Prevent publishing offerings that cannot be called by core (missing usable secret/env mapping).
- Return actionable validation errors before approval/publish.

## Recommended go-live gate

Release only when all are green:

1. `platform-api` + `core-router-executor` + `postgres` + `redis` run together in target environment.
2. At least one real model route passes non-stream + stream chat calls.
3. Billing/usage settlement and supplier usage counters update correctly after successful calls.
4. Invite/auth/admin/user console critical paths pass smoke tests.
