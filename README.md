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

# Optional
PORT=3000
XLLMAPI_DEEPSEEK_API_KEY=<for platform-owned offerings>
```

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

## Testing

```bash
# Unit tests
npm run test:platform-api

# E2E (requires postgres + redis + XLLMAPI_DEEPSEEK_API_KEY)
npm run test:e2e:mvp
```

## Docs

See [.agents/docs/v0.0.1/](/.agents/docs/v0.0.1/) for detailed architecture and deployment documentation.
