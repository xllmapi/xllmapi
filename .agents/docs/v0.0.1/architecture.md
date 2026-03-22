# xllmapi v0.0.1 Architecture

## Overview

xllmapi is a unified LLM API sharing platform. Users contribute provider API keys (DeepSeek, OpenAI, Anthropic) and in return gain access to all models on the network via a unified API.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / API Client                      │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   platform-api (Node)  │  :3000
                    │                        │
                    │  ┌──────────────────┐  │
                    │  │  Auth & Session   │  │  邀请制注册 + Email/密码登录
                    │  ├──────────────────┤  │
                    │  │  Offerings CRUD   │  │  凭据管理 + 模型供给
                    │  ├──────────────────┤  │
                    │  │  Provider Executor│  │  路由 + 熔断 + 重试 + 限流
                    │  │  ├─ OpenAI       │  │
                    │  │  ├─ Anthropic    │  │
                    │  │  └─ OAI-compat   │  │
                    │  ├──────────────────┤  │
                    │  │  Settlement      │  │  xtokens 结算 + 账本
                    │  ├──────────────────┤  │
                    │  │  Chat + SSE      │  │  对话管理 + 流式转发
                    │  ├──────────────────┤  │
                    │  │  Static (Vite)   │  │  前端 SPA 资源
                    │  └──────────────────┘  │
                    └───────┬────────┬───────┘
                            │        │
                   ┌────────▼──┐  ┌──▼────────┐
                   │ PostgreSQL │  │   Redis    │
                   │  (主存储)   │  │ (限流/缓存) │
                   └───────────┘  └───────────┘
```

## Key Design Decisions

### Single-process Node.js (v0.0.1)

The platform-api handles everything in one process:
- API routing & authentication
- Provider calls (direct HTTP to LLM providers)
- SSE streaming relay
- Static file serving (Vite-built frontend)

Previously there was a C++ core-router-executor, but it was replaced with TypeScript modules for simplicity.

### Provider Executor

The provider executor (`apps/platform-api/src/core/`) handles:

1. **Circuit breaker**: Per-offering failure tracking (3 failures → 30s cooldown)
2. **Retry with backoff**: 250ms base, max 3 attempts, only for retryable errors (429, 5xx, network)
3. **Concurrency limiter**: Promise-based semaphore, 32 concurrent by default
4. **Provider fallback**: Multiple offerings shuffled, falls back to next on failure
5. **Key decryption**: AES-256-GCM encrypted API keys, decrypted only in memory

### Token System (xtokens)

- Unified token unit across all models
- Settlement records input/output tokens per request
- Wallet balance tracked per user
- Overflow protection: clamped to INT32 MAX

### Authentication

- Invite-only registration
- Email verification codes (dev mode returns code in response)
- Session tokens (`sess_*` prefix)
- API keys (`xllm_*` prefix) for programmatic access
- Password login (optional)

## Data Model

Core tables (PostgreSQL):
- `users`, `sessions`, `api_keys`
- `invitations` (invite tree tracking)
- `provider_credentials` (encrypted API keys)
- `offerings` (model supply, requires admin review)
- `chat_settlements` (per-request token accounting)
- `wallets` (user balance)
- `chat_conversations`, `chat_messages` (conversation state)

## API Surface

### Public
- `GET /v1/models` — available models
- `GET /v1/network/models` — market model listing
- `GET /v1/public/users/:handle` — supplier profile
- `GET /v1/public/users/:handle/offerings` — supplier offerings

### Auth
- `POST /v1/auth/request-code` — email verification
- `POST /v1/auth/verify-code` — code validation → session
- `POST /v1/auth/login` — password login
- `GET /v1/auth/session` — session validation

### User (session auth)
- `GET /v1/me`, `PATCH /v1/me/profile`, `PATCH /v1/me/security/*`
- `GET/POST /v1/invitations`
- `GET/POST /v1/provider-credentials`
- `GET/POST /v1/offerings`
- `GET /v1/wallet`
- `GET /v1/usage/supply`, `/v1/usage/consumption`

### Chat (API key or session auth)
- `POST /v1/chat/completions` — OpenAI-compatible (stream/non-stream)
- `POST /v1/messages` — Anthropic-compatible
- `GET/POST /v1/chat/conversations` — conversation CRUD
- `POST /v1/chat/conversations/:id/stream` — conversation streaming

### Admin (admin session)
- `GET /v1/admin/users`, `/v1/admin/invitations`, `/v1/admin/usage`
- `GET /v1/admin/offerings/pending`, `PATCH /v1/admin/offerings/:id/review`

## Frontend Pages

- `/` — Landing page with model marketplace
- `/auth` — Login/register
- `/chat` — Chat interface with conversation management
- `/app` — User dashboard (overview, APIs, consumption, invitations, settings)
- `/admin` — Admin panel (users, invitations, reviews, usage)
- `/docs` — API documentation
