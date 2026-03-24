# xllmapi 模块化与子项目拆分方案

> 版本: v0.0.2 | 日期: 2026-03-24

## 目标

将 xllmapi 单体 monorepo 拆分为职责清晰的子项目，定义明确的协议和边界。同时引入统一日志、可观测性和 CI 验证机制。

---

## 当前结构

```
xllmapi/
  packages/shared-types/    ← 类型定义 (225 LOC, 单文件)
  apps/platform-api/        ← 后端 API (12K LOC, 职责过重)
  apps/web/                 ← 前端 (11.6K LOC)
  apps/node-cli/            ← 节点客户端 (895 LOC)
  infra/                    ← 部署配置
```

## 目标结构

```
xllmapi/
  packages/
    types/                  ← 协议与类型定义（公共契约）
    core/                   ← 核心引擎（provider 执行、断路器、上下文）
    logger/                 ← 统一日志库（分级控制）
  apps/
    platform/               ← 平台 API 服务（路由、服务、仓储）
    web/                    ← 前端
    node/                   ← 分布式节点客户端
  infra/                    ← 部署/运维配置
  scripts/                  ← 开发脚本
```

---

## 各子项目定义

### packages/types — 协议与类型

**职责**: 定义所有包之间的公共契约，零运行时代码

```
src/
  api/              HTTP API 类型
    chat.ts           ChatMessage, Request/Response
    offerings.ts      CandidateOffering, PricingMode
    market.ts         PublicMarketModel
    auth.ts           MeProfile, AuthRecord
    usage.ts          UsageSummary, SettlementRecord
  protocol/         WS 节点协议
    messages.ts       NodeMessage union
    capabilities.ts   NodeCapability
    constants.ts      协议版本, 超时常量
  models/           模型定义
    catalog.ts        LogicalModel, MODEL_CONTEXT_LIMITS
    providers.ts      ProviderType, ProviderPreset
  index.ts          统一导出
```

**依赖**: 无
**被依赖**: core, platform, node

### packages/core — 核心引擎

**职责**: 纯逻辑组件，不涉及 DB/网络/HTTP

```
src/
  executor/
    provider-executor.ts     请求执行引擎
    concurrency-limiter.ts   并发控制
  providers/
    openai.ts                OpenAI 兼容 streaming
    anthropic.ts             Anthropic streaming
    sse-parser.ts            SSE 流解析
  resilience/
    circuit-breaker.ts       断路器
    retry.ts                 重试策略
  context/
    context-manager.ts       上下文窗口管理 + trimToContextWindow
    strip-thinking.ts        thinking 内容剥离
  index.ts
```

**依赖**: `@xllmapi/types`, `@xllmapi/logger`
**导出**: `executeStreamingRequest`, `CircuitBreaker`, `trimToContextWindow`, `stripThinking`

### packages/logger — 统一日志库

**职责**: 所有子项目共享的结构化日志系统，支持分级控制

```
src/
  logger.ts           核心日志类
  levels.ts           日志级别定义 (TRACE, DEBUG, INFO, WARN, ERROR, FATAL)
  formatters.ts       输出格式 (JSON / pretty)
  context.ts          请求上下文传递 (requestId, userId, nodeId)
  index.ts
```

**特性**:
- 级别: `TRACE < DEBUG < INFO < WARN < ERROR < FATAL`
- 环境变量控制: `LOG_LEVEL=debug` / `LOG_LEVEL=info`（生产默认 info）
- 结构化 JSON 输出: `{ timestamp, level, message, requestId, module, context }`
- 模块标签: `logger.child({ module: 'chat' })` / `logger.child({ module: 'node-ws' })`
- 请求追踪: 每个请求带 `requestId`，贯穿整个调用链
- 性能计时: `logger.time('provider-call')` → `logger.timeEnd('provider-call')`

```typescript
// 使用示例
import { createLogger } from '@xllmapi/logger';

const log = createLogger({ module: 'chat', level: process.env.LOG_LEVEL });

log.debug('building context', { messageCount: 5, model: 'kimi-for-coding' });
log.info('request routed', { requestId, offeringId, model });
log.warn('offering skipped', { reason: 'daily_limit_exceeded', offeringId });
log.error('provider failed', { error: err.message, provider: 'kimi' });
```

**依赖**: 无
**被依赖**: core, platform, node

### apps/platform — 平台 API 服务

**职责**: HTTP/WS 服务器，业务逻辑，数据持久化

```
src/
  main.ts               服务入口
  routes/               HTTP 路由（保持现有 12 个文件）
  services/
    platform-service.ts   核心业务逻辑
    auth-service.ts       认证服务
    settlement-service.ts 结算服务
  repositories/
    platform-repository.ts  接口
    postgres/               PostgreSQL 实现
    sqlite/                 SQLite 开发实现
  node-network/
    connection-manager.ts   WS 节点连接管理
  middleware/
    security.ts
  lib/
    http.ts, errors.ts
```

**依赖**: `@xllmapi/types`, `@xllmapi/core`, `@xllmapi/logger`, `pg`, `redis`, `ws`

### apps/web — 前端

**职责**: React SPA，通过 HTTP API 与平台通信

结构不变。增加 `@xllmapi/logger` 的浏览器版本用于前端错误上报（可选）。

**依赖**: React, Tailwind, Vite（无代码层依赖其他子项目）

### apps/node — 分布式节点客户端

**职责**: 独立运行的 CLI 工具，连接平台 WS，执行 LLM 请求

```
src/
  main.ts          CLI 入口 + TUI
  ws-client.ts     WebSocket 客户端
  executor.ts      LLM 请求执行
  discovery.ts     模型发现
  config.ts        配置
```

**依赖**: `@xllmapi/types`, `@xllmapi/logger`, `ws`

---

## 依赖关系图

```
types (0 deps) ──────────────────────────┐
logger (0 deps) ─────────────────────────┤
                                         │
core (types + logger) ───────────────────┤
                                         │
platform (types + core + logger + DB)    │
web (独立，HTTP 通信)                    │
node (types + logger + ws)               │
infra (配置文件)                          │
```

---

## 统一日志与可观测性

### 日志级别策略

| 级别 | 用途 | 生产环境 |
|------|------|---------|
| TRACE | 每个 SSE delta、WS 消息 | 关闭 |
| DEBUG | 上下文构建、offering 选择、价格过滤 | 关闭 |
| INFO | 请求开始/完成、节点连接/断开、结算 | 开启 |
| WARN | offering 跳过（限流/离线）、429 重试 | 开启 |
| ERROR | provider 失败、结算失败、DB 错误 | 开启 |
| FATAL | 服务崩溃、数据库连接断开 | 开启 |

### 关键日志点

```
[chat] INFO  request_start   { requestId, model, userId, messageCount }
[chat] DEBUG context_built   { requestId, originalTokens, strippedTokens, contextLimit }
[chat] DEBUG offerings_found { requestId, count, models, executionModes }
[exec] INFO  provider_call   { requestId, offeringId, provider, model }
[exec] DEBUG sse_streaming   { requestId, deltaCount, totalTokens }
[exec] INFO  provider_done   { requestId, tokens, latencyMs }
[exec] WARN  provider_skip   { requestId, offeringId, reason }
[exec] ERROR provider_fail   { requestId, offeringId, error }
[settle] INFO settlement     { requestId, consumerCost, supplierReward, platformMargin }
[node-ws] INFO  connected    { nodeId, userId, ip }
[node-ws] INFO  disconnected { nodeId, reason }
[node-ws] DEBUG capabilities { nodeId, modelCount }
[node-ws] WARN  heartbeat_timeout { nodeId }
```

### 可观测性

- **请求追踪**: 每个 HTTP 请求生成 `requestId`，贯穿日志
- **节点追踪**: 每个 WS 连接有 `nodeId`
- **性能指标**: provider 延迟、结算耗时、WS 消息量
- **健康检查**: `/health` 端点返回服务状态 + 连接节点数

---

## 测试策略

### 单元测试

每个包独立测试：

```
packages/core/tests/
  circuit-breaker.test.ts
  retry.test.ts
  strip-thinking.test.ts
  context-manager.test.ts

packages/logger/tests/
  logger.test.ts
  levels.test.ts

apps/platform/tests/
  auth.test.ts
  settlement.test.ts
  node-connection.test.ts
```

### E2E 测试

```
scripts/
  e2e-platform.mjs      平台 API 端到端
  e2e-node-flow.mjs     节点连接 → 发现 → 接入 → 请求 → 结算
  e2e-chat-flow.mjs     Chat 对话 → 多轮 → 上下文管理
```

### CI 流水线

```yaml
# .github/workflows/ci.yml
jobs:
  types:
    - npm run build --workspace @xllmapi/types
    - npm run test --workspace @xllmapi/types

  logger:
    - npm run build --workspace @xllmapi/logger
    - npm run test --workspace @xllmapi/logger

  core:
    needs: [types, logger]
    - npm run build --workspace @xllmapi/core
    - npm run test --workspace @xllmapi/core

  platform:
    needs: [core]
    services: [postgres, redis]
    - npm run build --workspace @xllmapi/platform
    - npm run test --workspace @xllmapi/platform

  web:
    - npm run build --workspace @xllmapi/web

  node:
    needs: [types, logger]
    - npm run build --workspace @xllmapi/node

  e2e:
    needs: [platform, web, node]
    services: [postgres, redis]
    - npm run test:e2e
```

---

## 实施步骤

| 阶段 | 工作 |
|------|------|
| 1 | 创建 packages/logger，实现统一日志库 |
| 2 | 拆分 shared-types 为 packages/types 多文件模块 |
| 3 | 抽取 packages/core 从 platform-api/core |
| 4 | 重命名 apps/ 目录（platform-api→platform, node-cli→node） |
| 5 | 在所有包中集成 logger，替换现有 console.log / createLogger |
| 6 | 每个包写 README.md |
| 7 | 调整 workspace + CI 配置 |
| 8 | 全量构建 + E2E 测试验证 |
