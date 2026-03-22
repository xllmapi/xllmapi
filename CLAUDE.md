# xllmapi Development Guide

## Project Structure

Monorepo with npm workspaces:
- `apps/platform-api` — Node.js API server (TypeScript)
- `apps/web` — React frontend (Vite + Tailwind)
- `packages/shared-types` — Shared TypeScript types

## Build

```bash
npm install
npm run build   # builds shared-types → web → platform-api in order
```

## Run

```bash
# Dev (postgres + redis + platform-api)
./scripts/dev-up.sh
./scripts/dev-down.sh

# Or manually
node apps/platform-api/dist/main.js
```

## Backend Architecture

- `src/main.ts` — Thin server orchestrator (~200 lines)
- `src/routes/` — Route handlers by domain (auth, chat, user, provider, usage, network, admin, public)
- `src/lib/http.ts` — Shared request/response utilities
- `src/lib/errors.ts` — AppError class + error codes
- `src/lib/logger.ts` — Structured JSON logger
- `src/middleware/security.ts` — CORS + security headers
- `src/core/` — Provider executor, circuit breaker, retry, SSE parser
- `src/services/` — Business logic layer
- `src/repositories/` — Data access (PostgreSQL + SQLite)

## Route Handler Pattern

Each route file exports: `async function handleXRoutes(req, res, url, requestId): Promise<boolean>`
Returns `true` if handled, `false` to pass to next handler.

## Key Conventions

- All imports use `.js` extension (ESM)
- Database: PostgreSQL in production, SQLite for local dev
- Auth: Session tokens (`sess_*`) for browser, API keys for programmatic access
- Encryption: AES-256-GCM for provider API keys at rest
- Settlement: 85% supplier / 15% platform split
- Token unit: xtokens (platform internal currency)

## Testing

```bash
npm run test:platform-api     # Unit tests
npm run test:e2e:mvp          # E2E (requires postgres + redis + XLLMAPI_DEEPSEEK_API_KEY)
```

## Environment Variables

See `.env.example` for full list. Key ones:
- `XLLMAPI_ENV` — development|production
- `XLLMAPI_SECRET_KEY` — Required in production (AES key)
- `DATABASE_URL` — PostgreSQL connection
- `REDIS_URL` — Redis connection

## Database Migrations

Applied automatically by `scripts/dev-up.sh` or manually:
```bash
node apps/platform-api/dist/scripts/apply-postgres-migrations.js
```

Migration files: `infra/sql/postgres/001-006*.sql`
