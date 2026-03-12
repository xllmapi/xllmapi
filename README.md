# xllmapi

Unified LLM API gateway with a TS platform layer and a C++ routing/execution core.

## Project Plan (总体方案)

### 1. Product definition

xllmapi 是一个 **LLM API 共享网络 / 平台**：用户接入任意一个受支持模型厂商 API（或节点）后，可通过统一平台 token 体系兑换并使用其他模型能力。  
平台默认对外提供 OpenAI-compatible / Anthropic-compatible API。

### 2. Core user flow

1. 用户登录后在「我的 llm api」选择受支持 provider，提交 API key。
2. 服务端执行连通性测试（真实消息请求）并校验重复 key。
3. 校验通过后创建 credential + offering，接入共享网络并可被路由使用。
4. 其他用户通过统一 `/v1/chat/completions` 或流式接口调用模型。
5. 平台按调用量完成 token 结算，分别沉淀到供给与消费用量统计。

### 3. Architecture

- 前端 (`apps/web`)：官网 + 用户控制台 + 管理后台 + chat 页。
- 平台层 (`apps/platform-api`)：认证、邀请、凭据管理、offerings、账本、用量、公开资料、SSE/非流式 API。
- 核心执行层 (`apps/core-router-executor`, C++)：路由、供应候选选择、熔断/fallback、provider 实际调用。
- 数据层：Postgres（主存储）+ Redis（速率限制、幂等缓存）。
- 共享类型 (`packages/shared-types`)：前后端统一 DTO 与模型字段约束。

### 4. Current launch scope

- 邀请制注册（用户默认邀请上限，管理员可放开）。
- 用户侧：账户信息、邀请注册、连接模型到共享网络、供给/消费与总览用量。
- 管理侧：用户与邀请管理、模型供给与风险控制。
- 公共侧：官网、文档、公开聊天入口、供应商公开主页。
- 运维侧：健康检查、metrics、Docker Compose 一键拉起。

### 5. Key constraints

- provider key 不明文落库（加密存储）。
- 同一用户重复提交同一 provider/baseUrl/key 会被拒绝。
- offering 与 credential 有 ownership/risk 约束（禁用/删除顺序校验）。
- API 层保持 OpenAI-compatible / Anthropic-compatible 协议边界。

### 6. Next milestones

- 账本与结算精细化（兑付规则、审计报表）。
- 生产级风控（异常调用、质量评分、动态降权）。
- 供应网络扩展（更多 provider 适配与自动价格建议）。
- 运营能力（套餐、结算、支付）按阶段逐步上线。

## Layout

- `.agents/docs`: architecture and implementation docs
- `.agents/skills`: project-specific agent skills
- `apps/platform-api`: TS platform API bootstrap
- `apps/core-router-executor`: C++ core bootstrap
- `packages/shared-types`: shared DTOs and model names

## Current status

- skills and architecture docs initialized
- workspace scaffold initialized
- platform API health and model list endpoints added
- platform API key auth enabled
- SQLite-backed demo wallets, offerings, and settlements enabled
- C++ core executes real llmapi provider calls when provider env vars are set
- provider credentials support encrypted secret storage
- offerings and credentials support update/delete with ownership and risk checks
- `/v1/models` exposes live pricing/provider/owner summary metadata
- `/console` provides a minimal web control panel for credentials, offerings, wallet, and chat tests
- offerings now require admin review before they enter routing
- non-stream chat supports `Idempotency-Key`
- chat has a basic per-API-key rate limit
- platform now sends multiple candidate offerings to the core so fallback can happen end-to-end
- Postgres launch schema lives in `infra/sql/postgres/001_launch_mvp.sql`
- Postgres migration script and repository implementation are available in `@xllmapi/platform-api`
- Redis can back rate limiting and idempotency cache via `REDIS_URL`
- `/metrics` is available on both platform and core
- Docker Compose scaffold lives in `infra/docker/docker-compose.yml` and defaults to `Postgres + Redis`
- Docker Compose uses mirrored images for `postgres` and `redis` to avoid Docker Hub pull issues

## Local development

Build:

```bash
npm install
npm run build
cd apps/core-router-executor && xmake build
```

Postgres migration:

```bash
export DATABASE_URL=postgres://...
npm run db:migrate:postgres --workspace @xllmapi/platform-api
```

Tests:

```bash
npm run test:platform-api
```

Run:

```bash
./apps/core-router-executor/build/linux/x86_64/release/core-router-executor
node apps/platform-api/dist/main.js
```

Demo platform API key:

```text
xllm_demo_user_key_local
```

Demo admin API key:

```text
xllm_admin_key_local
```

Useful endpoints:

```bash
curl http://127.0.0.1:3000/v1/models
curl http://127.0.0.1:3000/v1/wallet -H 'Authorization: Bearer xllm_demo_user_key_local'
curl http://127.0.0.1:3000/v1/provider-credentials -H 'Authorization: Bearer xllm_demo_user_key_local'
curl http://127.0.0.1:3000/v1/offerings -H 'Authorization: Bearer xllm_demo_user_key_local'
curl http://127.0.0.1:3000/v1/admin/offerings/pending -H 'Authorization: Bearer xllm_admin_key_local'
curl http://127.0.0.1:3000/internal/debug/state
```

Console:

```text
http://127.0.0.1:3000/console
```

Real provider execution requires one or both env vars:

```bash
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
```

Production mode requires:

```bash
export XLLMAPI_ENV=production
export XLLMAPI_SECRET_KEY=...
export REDIS_URL=redis://...
export XLLMAPI_DB_DRIVER=postgres
export DATABASE_URL=postgres://...
```

Core execution tuning:

```bash
export XLLMAPI_CORE_MAX_CONCURRENT_REQUESTS=32
export XLLMAPI_CORE_MAX_RETRIES=1
export XLLMAPI_CORE_RETRY_BACKOFF_MS=250
export XLLMAPI_CORE_CIRCUIT_FAILURE_THRESHOLD=3
export XLLMAPI_CORE_CIRCUIT_OPEN_MS=30000
```

Database config:

```bash
# local development default
export XLLMAPI_DB_DRIVER=sqlite
export XLLMAPI_DB_PATH=.data/xllmapi.db

# launch target
export XLLMAPI_DB_DRIVER=postgres
export DATABASE_URL=postgres://...
```

Docker Compose:

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

Metrics:

```text
http://127.0.0.1:3000/metrics
http://127.0.0.1:4001/metrics
```
