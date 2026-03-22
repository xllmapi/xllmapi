# xllmapi v0.0.1 Deployment Guide

## Prerequisites

- Node.js 20+
- PostgreSQL 17
- Redis 7

## Environment Variables

### Required (Production)

```bash
XLLMAPI_ENV=production
XLLMAPI_SECRET_KEY=<32+ char secret for AES encryption>
XLLMAPI_DB_DRIVER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/xllmapi
REDIS_URL=redis://host:6379
```

### Optional

```bash
PORT=3000                              # HTTP listen port
XLLMAPI_DEEPSEEK_API_KEY=             # For platform-owned DeepSeek offerings
```

### Core Execution Tuning

```bash
XLLMAPI_CORE_MAX_CONCURRENT_REQUESTS=32
XLLMAPI_CORE_MAX_RETRIES=1
XLLMAPI_CORE_RETRY_BACKOFF_MS=250
XLLMAPI_CORE_CIRCUIT_FAILURE_THRESHOLD=3
XLLMAPI_CORE_CIRCUIT_OPEN_MS=30000
```

## Build

```bash
npm install
npm run build
```

This builds shared-types → web (Vite) → platform-api (tsc) in order.

## Database Migration

```bash
DATABASE_URL=postgresql://... node apps/platform-api/dist/scripts/apply-postgres-migrations.js
```

Migration SQL lives in `infra/sql/postgres/001_launch_mvp.sql`.

## Run

```bash
node apps/platform-api/dist/main.js
```

The server serves both the API and the Vite-built frontend SPA on the same port.

## Docker Compose (Development)

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

This starts PostgreSQL, Redis, and platform-api.

## Local Development

```bash
# Start postgres + redis + platform-api
./scripts/dev-up.sh

# Stop all
./scripts/dev-down.sh
```

## Seed Data

In development mode (`XLLMAPI_ENV=development`), the server auto-seeds:
- Admin user: `admin_demo@xllmapi.local`
- Regular user: `user_demo@xllmapi.local`
- Dev API keys: `xllm_demo_user_key_local`, `xllm_admin_key_local`

## Health Check

```bash
curl http://127.0.0.1:3000/healthz
```

## E2E Tests

```bash
# Requires XLLMAPI_DEEPSEEK_API_KEY and running postgres+redis
npm run test:e2e:mvp
npm run test:e2e:sharing
```
