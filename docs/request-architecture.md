# xllmapi 请求架构与信息流

> 最后更新：2026-03-29

## 系统架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              客户端层                                    │
│                                                                         │
│   Claude Code     Roo Code      浏览器 Chat       curl / SDK            │
│   (UA: claude-    (UA: roo-     (UA: Mozilla/     (UA: 自定义)           │
│    code/1.x)       code/1.x)     5.0...)                                │
└──────┬──────────────┬──────────────┬───────────────────┬────────────────┘
       │              │              │                   │
       │    API 代理路径              │  Chat 页面路径      │
       ▼              ▼              ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         xllmapi Platform API                            │
│                        (Node.js / TypeScript)                           │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  api-proxy   │  │    chat      │  │    admin     │  │  provider   │ │
│  │   routes     │  │   routes     │  │   routes     │  │   routes    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                 │                 │                  │        │
│         ▼                 ▼                 │                  │        │
│  ┌─────────────────────────────────┐        │                  │        │
│  │         core/router.ts          │        │                  │        │
│  │   (offering 解析 + 亲和路由)      │        │                  │        │
│  └──────────────┬──────────────────┘        │                  │        │
│                 ▼                            │                  │        │
│  ┌─────────────────────────────────┐        │                  │        │
│  │    core/provider-executor.ts     │        │                  │        │
│  │  ┌───────────────────────────┐  │        │                  │        │
│  │  │ resolveUpstreamHeaders()  │  │        │                  │        │
│  │  │  (header 解析引擎)         │  │        │                  │        │
│  │  └───────────────────────────┘  │        │                  │        │
│  │  ┌────────────┐ ┌────────────┐  │        │                  │        │
│  │  │ proxyApi   │ │ execute    │  │        │                  │        │
│  │  │ Request    │ │ Streaming  │  │        │                  │        │
│  │  └─────┬──────┘ └─────┬──────┘  │        │                  │        │
│  └────────┼──────────────┼─────────┘        │                  │        │
│           │              │                  │                  │        │
│  ┌────────┼──────────────┼──────────────────┼──────────────────┼───┐    │
│  │  adapters/            │  @xllmapi/core   │   services/      │   │    │
│  │  ┌────────┐  ┌──────┐ │  ┌────────────┐  │  ┌────────────┐ │   │    │
│  │  │ openai │  │anthr.│ │  │streamOpenAI│  │  │ platform   │ │   │    │
│  │  │adapter │  │adapter│ │  │streamAnthr.│  │  │  service   │ │   │    │
│  │  └────────┘  └──────┘ │  └────────────┘  │  └────────────┘ │   │    │
│  └────────┼──────────────┼──────────────────┼──────────────────┼───┘    │
│           │              │                  │                  │        │
│  ┌────────┼──────────────┼──────────────────┼──────────────────┼───┐    │
│  │        │         node-connection-manager │                  │   │    │
│  │        │              │        ┌─────────┘     repositories │   │    │
│  │        │              │        │  WebSocket                 │   │    │
│  └────────┼──────────────┼────────┼────────────────────────────┼───┘    │
└───────────┼──────────────┼────────┼────────────────────────────┼────────┘
            │              │        │                            │
            ▼              ▼        ▼                            ▼
┌───────────────────┐ ┌─────────────────┐              ┌─────────────────┐
│   LLM Providers   │ │   Node CLI      │              │   PostgreSQL    │
│                   │ │   (分布式节点)    │              │   + Redis       │
│  OpenAI           │ │  ┌───────────┐  │              │                 │
│  Anthropic        │ │  │ executor  │  │              │  provider_      │
│  DeepSeek         │ │  │  .ts      │──┼──► Provider  │  presets        │
│  Kimi Coding      │ │  └───────────┘  │              │  provider_      │
│  MiniMax          │ │                 │              │  credentials    │
│  Ollama           │ │                 │              │  offerings      │
└───────────────────┘ └─────────────────┘              └─────────────────┘
```

---

## 请求路径 1：API 代理（OpenAI / Anthropic 兼容）

适用场景：Claude Code、Roo Code、SDK、curl 等通过标准 API 格式调用。

```
客户端
  │  POST /v1/chat/completions          (OpenAI 格式)
  │  POST /anthropic/v1/messages        (Anthropic 格式)
  │  POST /xllmapi/v1/chat             (统一格式，自动检测)
  ▼
routes/api-proxy.ts
  │
  ├─ 1. 解析请求格式
  │     detectApiFormat() 根据 body 特征或 x-api-format header 判断
  │     → "openai" | "anthropic"
  │
  ├─ 2. 认证
  │     authenticate_request_() → Bearer token 或 x-api-key
  │
  ├─ 3. 速率限制
  │     cacheService.consumeRateLimit() → Redis 滑动窗口
  │
  ├─ 4. 钱包余额检查
  │     platformService.getWallet() > 0
  │
  ├─ 5. Offering 解析
  │     core/router.ts → resolveOfferings(model, userId)
  │     查询用户连接池 → findUserOfferingsForModel()
  │     或公共 offerings → findOfferingsForModel()
  │
  ├─ 6. 提取客户端 User-Agent
  │     req.headers["user-agent"] → clientUserAgent
  │
  └─ 7. 代理执行
       core/provider-executor.ts → proxyApiRequest()
         │
         ├─ 过滤: 熔断器、日限额、并发槽位
         ├─ 排序: 优先同格式端点
         │
         │  对每个可用 offering:
         ├─ a. resolveApiKey() → 解密 AES-256-GCM 密钥
         ├─ b. resolveEndpoint() → 目标格式 + base URL
         ├─ c. adapter.buildHeaders(apiKey) → 基础 headers
         ├─ d. ★ resolveUpstreamHeaders() → 合并自定义 headers
         │     （详见 "Header 解析策略"）
         ├─ e. adapter.prepareBody() → 替换 model、限制 max_tokens
         ├─ f. convertRequestBody() → 跨格式转换（如需要）
         ├─ g. fetch(url, { headers, body }) → 上游 provider
         │
         ├─ 流式: 逐 chunk 写回客户端（含格式转换）
         ├─ 非流式: 整体返回（含格式转换）
         └─ 提取 usage → 结算
              │
              ▼
         platformService.recordChatSettlement()
         → 85% supplier / 15% platform 分成
```

**关键文件：**
| 步骤 | 文件 |
|------|------|
| 入口 + 认证 | `apps/platform-api/src/routes/api-proxy.ts` |
| Offering 路由 | `apps/platform-api/src/core/router.ts` |
| 代理执行 + Header 解析 | `apps/platform-api/src/core/provider-executor.ts` |
| OpenAI adapter | `apps/platform-api/src/core/adapters/openai.ts` |
| Anthropic adapter | `apps/platform-api/src/core/adapters/anthropic.ts` |
| 格式转换 | `apps/platform-api/src/core/adapters/response-converter.ts` |
| 结算 | `apps/platform-api/src/services/platform-service.ts` |

---

## 请求路径 2：Chat 页面对话

适用场景：xllmapi Web UI 的 Chat 页面，浏览器直接与 API 交互。

```
浏览器 (React)
  │
  ├─ ChatPage.tsx → useChatStore.ts → sendMessage()
  │  创建 conversation (POST /v1/chat/conversations)
  │  发送消息 (POST /v1/chat/conversations/:id/stream)
  │  SSE 流式接收 → 逐 delta 更新 UI
  │
  ▼
routes/chat.ts
  │
  ├─ 1. 认证 (仅 session token)
  │     authenticate_session_only_()
  │
  ├─ 2. 加载对话 + 消息历史
  │     platformService.getConversation()
  │     platformService.listConversationMessages()
  │
  ├─ 3. 上下文裁剪
  │     trimToContextWindow(messages, contextLimit)
  │     （按模型上下文窗口裁剪历史消息）
  │
  ├─ 4. Offering 路由（含亲和性）
  │     core/router.ts → routeRequest()
  │     ├─ resolveOfferings()
  │     ├─ filterAvailable() → 熔断器 + 日限额 + 并发
  │     └─ selectOffering()
  │          ├─ 对话亲和: 同 conversation 优先复用上次 offering
  │          ├─ 用户亲和: 最近使用过的 offering
  │          └─ 负载均衡: top-3 随机
  │
  ├─ 5. 提取客户端 User-Agent
  │     req.headers["user-agent"] → clientUserAgent
  │
  └─ 6. 流式执行
       core/provider-executor.ts → executeStreamingRequest()
         │
         ├─ resolveApiKey()
         ├─ resolveBaseUrl()
         ├─ ★ resolveUpstreamHeaders() → extraHeaders
         │
         ├─ Anthropic provider:
         │    @xllmapi/core → streamAnthropic({ extraHeaders })
         │    SSE: message_start → content_block_delta → message_delta
         │    → 转换为 OpenAI 格式 SSE 写回客户端
         │
         └─ OpenAI-compatible provider:
              @xllmapi/core → streamOpenAI({ extraHeaders })
              SSE: data: {"choices":[{"delta":{"content":"..."}}]}
              → 直接写回客户端
         │
         ▼
    结算 + 记录亲和性 + 保存助手消息
```

**关键文件：**
| 步骤 | 文件 |
|------|------|
| 前端 Chat 页面 | `apps/web/src/pages/chat/ChatPage.tsx` |
| Chat 状态管理 | `apps/web/src/pages/chat/hooks/useChatStore.ts` |
| SSE 解析 | `apps/web/src/lib/stream.ts` |
| 后端路由 | `apps/platform-api/src/routes/chat.ts` |
| 亲和路由 | `apps/platform-api/src/core/router.ts` |
| 流式执行 | `apps/platform-api/src/core/provider-executor.ts` |
| OpenAI 流式 | `packages/core/src/providers/openai.ts` |
| Anthropic 流式 | `packages/core/src/providers/anthropic.ts` |

---

## 请求路径 3：分布式 Node 节点执行

适用场景：供应商通过 Node CLI 连接平台，由节点代理执行 LLM 请求。

```
Platform API                          Node CLI
    │                                     │
    │  WebSocket /ws/node                 │
    │◄────────────────────────────────────┤ 连接 + 认证
    │  { type: "auth", token: "ntok_*" }  │
    │────────────────────────────────────►│ auth.ok
    │                                     │
    │  心跳 (30s)                          │
    │◄──── { type: "pong", uptime, load } │
    │                                     │
    │  === 收到用户请求 ===                 │
    │                                     │
provider-executor.ts                      │
    │ executeStreamingRequest()            │
    │ → offering.executionMode === 'node'  │
    │                                     │
    │ resolveUpstreamHeaders()             │
    │ → extraHeaders                       │
    │                                     │
node-connection-manager.ts                │
    │ dispatch(nodeId, requestId, {        │
    │   model, messages (AES加密),          │
    │   temperature, maxTokens,            │
    │   extraHeaders                       │
    │ })                                   │
    │────────────────────────────────────►│
    │  { type: "request", requestId,       │
    │    payload: { encryptedMessages,     │
    │    encryptionKey, encryptionIv,      │
    │    extraHeaders, ... } }             │
    │                                     │
    │                                executor.ts
    │                                     │ 解密 messages
    │                                     │ 匹配 provider config
    │                                     │ 构建 headers:
    │                                     │   默认 UA + ...extraHeaders
    │                                     │ fetch → LLM Provider
    │                                     │
    │◄──── SSE delta chunks ──────────────│
    │  { type: "stream", requestId,       │
    │    delta: "..." }                    │
    │                                     │
    │◄──── completion ────────────────────│
    │  { type: "done", requestId,         │
    │    content, usage, finishReason }    │
    │                                     │
    ▼                                     │
  写回客户端 SSE + 结算                     │
```

**关键文件：**
| 组件 | 文件 |
|------|------|
| WebSocket 管理 + 调度 | `apps/platform-api/src/core/node-connection-manager.ts` |
| Node CLI 入口 | `apps/node-cli/src/main.ts` |
| Node CLI 执行器 | `apps/node-cli/src/executor.ts` |
| Node CLI WebSocket | `apps/node-cli/src/ws-client.ts` |

---

## 请求路径 4：管理员 Preset 配置

管理员通过后台 UI 配置 provider presets（包括 custom headers）。

```
管理员浏览器
  │
  ▼
ProvidersPage.tsx (React)
  │
  ├─ 加载: GET /v1/admin/provider-presets
  │  → 表格展示所有 presets
  │
  ├─ 编辑表单:
  │  ├─ ID, Label, Provider Type, Base URL
  │  ├─ Anthropic Base URL (可选)
  │  ├─ Models (JSON editor)
  │  ├─ Custom Headers (JSON editor)  ← 新增
  │  │   示例: {"headers":{"user-agent":{"value":"claude-code/1.0","mode":"force"}}}
  │  ├─ Enabled 开关
  │  └─ Sort Order
  │
  ├─ 创建: POST /v1/admin/provider-presets
  └─ 更新: PUT /v1/admin/provider-presets/:id
       │
       ▼
  routes/admin.ts
       │ 管理员权限校验 (role === "admin")
       ▼
  services/platform-service.ts
       │ upsertProviderPreset({ ..., customHeaders })
       ▼
  repositories/postgres-platform-repository.ts
       │ INSERT ... ON CONFLICT DO UPDATE
       ▼
  PostgreSQL: provider_presets 表
       │
       │  custom_headers JSONB 列
       │  ┌──────────────────────────────────────────────┐
       │  │ {                                            │
       │  │   "headers": {                               │
       │  │     "user-agent": {                          │
       │  │       "value": "claude-code/1.0",            │
       │  │       "mode": "force"                        │
       │  │     }                                        │
       │  │   }                                          │
       │  │ }                                            │
       │  └──────────────────────────────────────────────┘
       ▼
  用户创建 credential 时:
  routes/provider.ts → POST /v1/provider-credentials
       │ providerPreset = getProviderPresetById(providerId)
       │ customHeaders = providerPreset.customHeaders  ← 继承
       ▼
  provider_credentials.custom_headers = preset 的配置
       │
       ▼
  offering 查询时:
  SELECT ... c.custom_headers AS "customHeaders" FROM offerings o
  JOIN provider_credentials c ON ...
       │
       ▼
  CandidateOffering.customHeaders → resolveUpstreamHeaders()
```

**关键文件：**
| 层级 | 文件 |
|------|------|
| 前端 UI | `apps/web/src/pages/admin/ProvidersPage.tsx` |
| Admin API | `apps/platform-api/src/routes/admin.ts` |
| Service | `apps/platform-api/src/services/platform-service.ts` |
| Repository | `apps/platform-api/src/repositories/postgres-platform-repository.ts` |
| DB Schema | `infra/sql/postgres/012_provider_presets.sql` + `014_custom_headers.sql` |

---

## Header 解析策略

`resolveUpstreamHeaders()` 是所有请求路径的 header 处理核心。

```
                    ┌──────────────────────┐
                    │   客户端请求 headers    │
                    │   User-Agent: ???     │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  isCodingAgentUA()    │
                    │  过滤浏览器 UA         │
                    │                      │
                    │  "claude-code/1.0"   │ → ✓ coding agent
                    │  "roo-code/1.2"      │ → ✓ coding agent
                    │  "Mozilla/5.0..."    │ → ✗ 浏览器，忽略
                    │  "curl/8.0"          │ → ✓ coding agent
                    └──────────┬───────────┘
                               │
                               │ agentUA = coding agent UA 或 undefined
                               │
              ┌────────────────▼────────────────┐
              │  offering.customHeaders 配置?     │
              └────────┬───────────┬────────────┘
                       │           │
                  无配置 │           │ 有配置
                       ▼           ▼
            ┌──────────────┐  ┌─────────────────────────────┐
            │ 默认行为:     │  │ 逐条处理 headers 规则:       │
            │              │  │                             │
            │ agentUA 存在? │  │  mode: "force"              │
            │ → 透传到上游   │  │  → 强制使用配置值             │
            │              │  │  → 忽略客户端                │
            │ agentUA 为空? │  │                             │
            │ → 保持 adapter │  │  mode: "fallback"           │
            │   默认值      │  │  → agentUA 存在? 用 agentUA  │
            │              │  │  → agentUA 为空? 用配置值     │
            └──────────────┘  │                             │
                              │  占位符:                     │
                              │  $CLIENT_USER_AGENT          │
                              │  → 解析为 agentUA             │
                              │  → 无则 fallback claude-code │
                              │                             │
                              │  passthrough:                │
                              │  → true: 透传未覆盖的 agentUA │
                              │  → false: 不透传             │
                              └─────────────────────────────┘
                                           │
                                           ▼
                              ┌─────────────────────────┐
                              │  最终 headers 发送到      │
                              │  上游 LLM Provider       │
                              └─────────────────────────┘
```

### Kimi Coding 实际效果

Kimi Coding API 只接受 `claude-code/*`（小写）User-Agent。
配置: `{"headers":{"user-agent":{"value":"claude-code/1.0","mode":"force"}}}`

| 客户端 | 客户端 UA | 发送到 Kimi 的 UA | 结果 |
|--------|-----------|-------------------|------|
| Claude Code | `claude-code/1.0.23` | `claude-code/1.0` (force) | ✓ |
| Roo Code | `roo-code/1.2.0` | `claude-code/1.0` (force) | ✓ |
| 浏览器 Chat | `Mozilla/5.0...` | `claude-code/1.0` (force) | ✓ |
| curl | `curl/8.0` | `claude-code/1.0` (force) | ✓ |

---

## 数据模型关系

```
provider_presets                    provider_credentials
┌──────────────────────┐           ┌──────────────────────────┐
│ id (PK)              │           │ id (PK)                  │
│ label                │  继承      │ owner_user_id (FK→users) │
│ provider_type        │──────────►│ provider_type            │
│ base_url             │           │ base_url                 │
│ anthropic_base_url   │           │ anthropic_base_url       │
│ models (JSONB)       │           │ encrypted_secret         │
│ custom_headers (JSONB)│──────────►│ custom_headers (JSONB)   │
│ enabled              │           │ api_key_fingerprint      │
│ sort_order           │           │ status                   │
└──────────────────────┘           └────────────┬─────────────┘
                                                │
                                                │ credential_id
                                                ▼
                                   ┌──────────────────────────┐
                                   │ offerings                 │
                                   │ id (PK)                  │
                                   │ owner_user_id (FK→users) │
                                   │ logical_model            │
                                   │ credential_id (FK)       │
                                   │ real_model               │
                                   │ pricing_mode             │
                                   │ fixed_price_per_1k_*     │
                                   │ execution_mode           │
                                   │ node_id                  │
                                   │ daily_token_limit        │
                                   │ max_concurrency          │
                                   │ enabled                  │
                                   │ review_status            │
                                   └──────────────────────────┘
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        ▼                       ▼                       ▼
               ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
               │ CandidateOffering│    │ offering_       │    │ api_requests     │
               │ (运行时类型)      │    │ favorites       │    │ (结算记录)       │
               │                 │    │ user_id         │    │ requester_id    │
               │ + customHeaders │    │ offering_id     │    │ chosen_offering │
               │   (from cred)   │    │ paused          │    │ usage tokens    │
               └─────────────────┘    └─────────────────┘    └─────────────────┘
```

### custom_headers JSONB 结构

```jsonc
{
  "headers": {
    "<header-name>": {
      "value": "<string | $CLIENT_USER_AGENT>",
      "mode": "force | fallback"
    }
  },
  "passthrough": true | false    // 是否透传 coding agent 的 UA
}
```

---

## 核心文件索引

| 模块 | 文件路径 | 职责 |
|------|---------|------|
| **路由** | `apps/platform-api/src/routes/api-proxy.ts` | API 代理入口 (OpenAI / Anthropic / 统一) |
| | `apps/platform-api/src/routes/chat.ts` | Chat 页面对话 |
| | `apps/platform-api/src/routes/provider.ts` | Provider credential + offering CRUD |
| | `apps/platform-api/src/routes/admin.ts` | 管理员 preset 管理 |
| **核心** | `apps/platform-api/src/core/router.ts` | Offering 解析 + 亲和路由 |
| | `apps/platform-api/src/core/provider-executor.ts` | 请求执行 + header 解析引擎 |
| | `apps/platform-api/src/core/adapters/openai.ts` | OpenAI 格式适配器 |
| | `apps/platform-api/src/core/adapters/anthropic.ts` | Anthropic 格式适配器 |
| | `apps/platform-api/src/core/adapters/response-converter.ts` | 跨格式 SSE/JSON 转换 |
| | `apps/platform-api/src/core/node-connection-manager.ts` | Node WebSocket 管理 |
| | `apps/platform-api/src/core/context-affinity.ts` | 对话 + 用户亲和性 |
| | `apps/platform-api/src/core/offering-queue.ts` | Per-offering 并发队列 |
| **Core 包** | `packages/core/src/providers/openai.ts` | OpenAI 流式/非流式调用 |
| | `packages/core/src/providers/anthropic.ts` | Anthropic 流式/非流式调用 |
| | `packages/core/src/providers/sse-parser.ts` | SSE 流解析器 |
| | `packages/core/src/resilience/` | 熔断器 + 重试 + 并发限制 |
| | `packages/core/src/context/context-manager.ts` | 模型上下文窗口限制 |
| **Service** | `apps/platform-api/src/services/platform-service.ts` | 业务逻辑 (结算、邮件、preset 等) |
| **Repository** | `apps/platform-api/src/repositories/postgres-platform-repository.ts` | PostgreSQL 数据访问 |
| **Node CLI** | `apps/node-cli/src/main.ts` | Node 节点入口 |
| | `apps/node-cli/src/executor.ts` | LLM 请求执行器 |
| **前端** | `apps/web/src/pages/chat/ChatPage.tsx` | Chat 页面组件 |
| | `apps/web/src/pages/chat/hooks/useChatStore.ts` | Chat 状态管理 |
| | `apps/web/src/pages/admin/ProvidersPage.tsx` | 管理员 preset 配置页 |
| **DB** | `infra/sql/postgres/001-014*.sql` | 数据库 migration |
