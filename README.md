# xllmapi

Unified LLM API sharing platform — users contribute provider API keys and gain access to all models on the network via a single API.

## Architecture

```
Browser / API Client
        │
┌───────▼────────┐
│  platform-api   │  :3000  (Node.js)
│                 │
│  Auth & Session │  邀请制注册, Email/密码登录
│  Email Security │  邀请邮件, 找回密码, 邮箱变更确认
│  Offerings CRUD │  凭据管理, 模型供给
│  Provider Exec  │  路由, 熔断, 重试, 限流
│  Settlement     │  xtokens 结算
│  Chat + SSE     │  对话管理, 流式转发
│  Static (Vite)  │  前端 SPA
└──────┬──┬──────┘
       │  │
  Postgres Redis
```

Single-process Node.js server handles API, provider calls, and serves the frontend. Provider executor includes circuit breaker, retry with exponential backoff, concurrency limiting, and multi-offering fallback.

## Project Structure

```
├── apps/
│   ├── platform-api/          # Node.js API server
│   │   ├── src/
│   │   │   ├── core/          # Provider executor, circuit breaker, retry, SSE parser
│   │   │   │   ├── providers/ # OpenAI, Anthropic, OpenAI-compatible adapters
│   │   │   │   ├── circuit-breaker.ts
│   │   │   │   ├── concurrency-limiter.ts
│   │   │   │   ├── provider-executor.ts
│   │   │   │   ├── retry.ts
│   │   │   │   └── sse-parser.ts
│   │   │   ├── repositories/  # SQLite (dev) + PostgreSQL (prod)
│   │   │   ├── services/      # Business logic
│   │   │   ├── db.ts          # SQLite queries
│   │   │   └── main.ts        # HTTP server + routes
│   │   └── dist/              # Compiled output
│   └── web/                   # React frontend (Vite)
│       └── src/
│           ├── pages/         # Landing, Auth, Chat, App dashboard, Admin
│           ├── components/    # Shared UI components
│           └── lib/           # API client, i18n, utils
├── packages/
│   └── shared-types/          # Shared TypeScript types
├── infra/
│   ├── docker/                # Docker Compose + Dockerfiles
│   └── sql/postgres/          # Migration scripts
├── scripts/                   # Dev scripts + E2E tests
└── .agents/docs/              # Architecture & deployment docs
```

## Quick Start

```bash
# Install & build
npm install
npm run build

# Start with Docker Compose (Postgres + Redis + API)
docker compose -f infra/docker/docker-compose.yml up --build

# Or local development
./scripts/dev-up.sh
```

## Local Development

```bash
# Start postgres + redis + platform-api
./scripts/dev-up.sh

# Stop
./scripts/dev-down.sh
```

Dev mode auto-seeds:
- Admin: `admin_demo@xllmapi.local`
- User: `user_demo@xllmapi.local`

Web UI: http://127.0.0.1:3000

## Environment Variables

```bash
# Required (production)
XLLMAPI_ENV=production
XLLMAPI_SECRET_KEY=<secret for AES-256-GCM key encryption>
XLLMAPI_DB_DRIVER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/xllmapi
REDIS_URL=redis://host:6379
XLLMAPI_CORS_ORIGINS=https://app.example.com

# Optional
PORT=3000
XLLMAPI_RELEASE_ID=<git sha or deploy timestamp>
XLLMAPI_APP_BASE_URL=https://app.example.com
XLLMAPI_EMAIL_PROVIDER=resend
XLLMAPI_EMAIL_FROM=noreply@example.com
XLLMAPI_RESEND_API_KEY=<resend api key>
XLLMAPI_DEEPSEEK_API_KEY=<for platform-owned offerings>
XLLMAPI_NODE_IMAGE=<optional docker base image override for compose builds>
```

Production notes:

- `sqlite` is development-only and should not be used in production.
- `GET /healthz` is liveness, `GET /readyz` is readiness.
- `GET /version` reports the current release identifier.
- Browser sign-in now uses an HttpOnly session cookie by default; Bearer session tokens and API keys remain supported for programmatic clients.
- Transactional email flows now cover invitation delivery, email-code sign-in, password reset, and email change confirmation.
- frontend assets can be built under `/_releases/<release-id>/...` to support safer rolling upgrades.

## API

OpenAI-compatible:
```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "x-api-key: YOUR_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hello"}]}'
```

Key endpoints:
- `POST /v1/chat/completions` — Chat (stream/non-stream)
- `GET /v1/models` — Available models
- `GET /v1/me` — User profile
- `GET /v1/wallet` — Token balance
- `GET /v1/usage/consumption` — Usage stats
- `GET /v1/admin/settlement-failures` — Admin settlement failure queue
- `GET /v1/admin/email-deliveries` — Admin transactional email delivery log
- `GET /v1/admin/security-events` — Admin account security events

## Testing

```bash
# Unit tests
npm run test:platform-api

# E2E (runs against a real provider when XLLMAPI_DEEPSEEK_API_KEY is set,
# otherwise falls back to a local mock OpenAI-compatible provider)
npm run test:e2e:mvp
npm run test:e2e:sharing
# Ops: retry persisted settlement failures
npm run ops:retry:settlement-failures

# Release smoke (expects a running instance on http://127.0.0.1:3000 by default)
npm run smoke:release
```

CI release gates:

- TypeScript build + platform build
- Docker image build
- platform-api test suite
- `test:e2e:mvp` on every PR / push
- `test:e2e:sharing` on `main`
- production container smoke against `/healthz`, `/readyz`, and `/version`

## Docs

- [Deployment guide](/home/speak/workspace/github/xllmapi/xllmapi/docs/deploy.md)
- [Auth / Email security design](/home/speak/workspace/github/xllmapi/xllmapi/docs/auth-email-invitation-and-security-design.md)
- [Production readiness plan](/home/speak/workspace/github/xllmapi/xllmapi/docs/production-readiness-and-zero-downtime-plan.md)
- [Observability assets](/home/speak/workspace/github/xllmapi/xllmapi/infra/observability/README.md)
