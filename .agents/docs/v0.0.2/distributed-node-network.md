# 分布式模型节点网络 — 设计方案

> 版本: v0.0.2 | 日期: 2026-03-23

## Context

当前 xllmapi 平台要求供应商将 API Key 上传到平台加密存储，由平台服务器代理所有 LLM 请求。这带来三个问题：
1. **安全信任** — 用户不愿将 Key 交给平台
2. **扩展瓶颈** — 所有请求经平台服务器，无法横向扩展
3. **封号风险** — 平台 IP 集中发起大量请求，容易被供应商封禁

本方案引入**分布式节点网络**：用户在本地运行轻量节点，节点持有 API Key 并直接调用 LLM，平台只做路由和结算。

## Architecture: Thin Relay over WebSocket

### 核心原则
- 节点是**瘦客户端** — 只负责执行 LLM 请求，所有业务逻辑在平台
- 节点**主动连接**平台（WebSocket），无需公网 IP
- 支持**远程 API**（OpenAI, Anthropic, DeepSeek）+ **本地模型**（Ollama, vLLM）
- **Opt-in 模式** — 消费者默认只用平台侧 offerings，可多粒度选择启用节点

---

## 1. 连接协议

**Transport**: WebSocket (`wss://` in production)

**消息格式** — JSON envelopes with `type` field:

```
# Auth
→ { type: "auth", token: "ntok_xxx", protocolVersion: 1 }
← { type: "auth.ok", nodeId: "node_xxx" }
← { type: "auth.error", message: "..." }

# Heartbeat (每 30s)
← { type: "ping" }
→ { type: "pong", uptime: 3600, activeRequests: 2, load: 0.3 }

# Capability Advertisement (auth 后 + 变更时)
→ { type: "capabilities", models: [
    { realModel: "deepseek-chat", providerType: "openai_compatible", maxConcurrency: 5 },
    { realModel: "llama3-70b", providerType: "ollama", maxConcurrency: 2 }
  ]}

# Request Dispatch
← { type: "request", requestId: "req_xxx", payload: {
    model: "deepseek-chat", messages: [...], temperature: 0.7, maxTokens: 4096, stream: true
  }}

# Streaming Response
→ { type: "response.delta", requestId: "req_xxx", delta: "Hello" }
→ { type: "response.done", requestId: "req_xxx", content: "...",
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    finishReason: "stop" }
→ { type: "response.error", requestId: "req_xxx", error: { code: "provider_error", message: "..." } }
```

**重连策略**: 指数退避 1s → 2s → 4s → 8s → max 60s，使用同一 `ntok_*` 重新认证。

---

## 2. 节点注册 & 认证

- 用户在 Web 界面或 API 创建 **Node Token** (`ntok_*`)
  - `POST /v1/nodes/tokens` → 返回明文 token（仅一次）
  - 平台存储 SHA256 hash（复用现有 API Key 模式）
- 节点启动时用 token 通过 WS auth 消息认证
- 认证成功后平台创建/更新 `nodes` 记录，标记 online
- 一个用户可有多个 token/节点（不同机器）
- Token 可从 dashboard 撤销，立即断开 WS

---

## 3. Offering 管理 — 节点 vs 平台

offerings 表新增字段区分执行方式：

| 字段 | 说明 |
|------|------|
| `execution_mode` | `'platform'`（现有）或 `'node'` |
| `node_id` | 关联的节点 ID（`node_id` 为 node offering 特有） |

**节点上线流程**:
1. 节点连接并发送 capabilities → 平台记录节点的可用模型列表（不自动创建 offering）
2. **用户在控制台手动选择**要发布的模型 → 创建 offering（`execution_mode = 'node'`, `review_status = 'pending'`）
3. 管理员审核通过 → offering 变为 `approved` + `enabled`
4. 节点下线 → 对应 offerings 自动标记为不可用（保留 offering 记录，但不参与路由）
5. 节点重连 → 已审核的 offerings 自动恢复可用
6. 用户可随时暂停/恢复/下架 offering

**管理审核**:
- 节点 offerings 需要 admin 审核 (`review_status: pending → approved`)
- 首次发布的模型需要审核，已审核过的模型重连后自动恢复（无需重新审核）

---

## 4. 请求路由 — Opt-in 多粒度选择

**消费者偏好**（存储在 `user_node_preferences` 表）:

```
全局开关: allow_distributed_nodes = false (默认关闭)

如果开启，可进一步配置:
  - 信任所有节点 offerings (trust_mode = 'all')
  - 信任特定供应商 (trust_mode = 'supplier', trusted_supplier_ids = [...])
  - 信任特定 offerings (trust_mode = 'offering', trusted_offering_ids = [...])
```

**路由逻辑修改**（`provider-executor.ts`）:

```
findOfferingsForModel(logicalModel, userId):
  1. 查询所有 enabled + approved 的 offerings for logicalModel
  2. 过滤: platform offerings 始终包含
  3. 如果 user.allow_distributed_nodes = true:
     a. trust_mode = 'all' → 包含所有在线节点 offerings
     b. trust_mode = 'supplier' → 只包含 trusted supplier 的节点 offerings
     c. trust_mode = 'offering' → 只包含明确信任的节点 offerings
  4. 返回过滤后的 candidate list → 进入现有 shuffle + circuit breaker 循环
```

**执行分支**（`provider-executor.ts` 循环内）:

```
for (const offering of candidates) {
  if (offering.executionMode === 'platform') {
    // 现有逻辑: decrypt key, call provider directly
  } else if (offering.executionMode === 'node') {
    // 新逻辑: dispatch to NodeConnectionManager
    result = await nodeConnectionManager.dispatch(offering.nodeId, requestId, payload, onSseWrite);
  }
}
```

---

## 5. 节点执行流程（Streaming）

```
Consumer → POST /v1/chat/completions { stream: true }
  → Platform: auth, find offerings, select node offering
  → Platform → WS → Node: { type: "request", requestId, payload }
  → Node: resolve local API key / connect to Ollama
  → Node: call LLM provider, receive SSE stream
  → Node → WS → Platform: { type: "response.delta", delta: "..." } (per token)
  → Platform: onSseWrite(delta) → SSE to Consumer
  → Node → WS → Platform: { type: "response.done", usage, finishReason }
  → Platform: recordChatSettlement(consumerCost, supplierReward=85%, platformMargin=15%)
  → Platform: close SSE to Consumer
```

**超时**: 120s 无 response.done → 记录失败 → 断路器 → 尝试下一个 offering

---

## 6. Token 计数 & 结算

- **节点报告 usage**: response.done 中包含 `{ inputTokens, outputTokens, totalTokens }`
  - 远程 API: 直接使用 provider 返回的 usage
  - 本地模型: Ollama/vLLM 自带 token 计数，fallback 到 tiktoken 估算
- **平台交叉校验**: `estimateTokens(messages)` 与节点报告的 inputTokens 对比，±30% 容差
  - 超出容差: 标记可疑，不立即拒绝，累计多次后降低节点信誉分
- **结算流程**: 完全复用现有 `recordChatSettlement()`，supplierUserId = 节点 owner

---

## 7. 健康监控 & 稳定性评估

**实时指标**（展示给消费者参考）:
- `online_uptime_7d` — 过去 7 天在线时长百分比
- `success_rate_1h` — 最近 1 小时请求成功率
- `p95_latency_ms` — P95 延迟
- `total_requests_served` — 累计服务请求数
- `avg_response_time_ms` — 平均响应时间

**断路器**: 复用现有 `circuit-breaker.ts`（3 次失败 → 30s 冷却 → half-open 探测）

**心跳**: 30s ping/pong，10s 超时无响应 → 标记 offline → disable offerings

**节点信誉分** (`node_reputation_score`):
- 基于: 在线率、成功率、延迟稳定性、token 计数准确度、**用户投票**
- 展示给消费者作为选择参考
- 低信誉节点可被管理员审查/禁用

**用户投票（点赞/点踩）**:
- 消费者可对分布式节点 offering 进行**点赞（upvote）或点踩（downvote）**
- **每个账号对每个节点 offering 只能投一次票**（可更改投票方向，但不能重复投）
- 投票数据公开展示供其他消费者参考
- 投票纳入信誉分计算：`reputation_score = f(uptime, success_rate, latency, token_accuracy, vote_ratio)`
- 投票需要消费者**至少使用过该节点一次**才能投票（防止刷票）

---

## 8. 安全考虑

| 风险 | 缓解措施 |
|------|----------|
| API Key 泄露 | Key 永不离开节点，平台只发送请求 payload |
| WS 中间人攻击 | 生产环境强制 wss://（TLS） |
| 节点伪造响应 | 消费者投票（点赞/点踩）+ token 计数交叉校验 + 信誉分体系 |
| Token 被盗 | ntok_* 可从 dashboard 即时撤销 |
| 节点窃取用户消息 | 节点作为供应商角色，天然会看到消息内容（同现有供应商模式） |
| IP 封号 | 请求分散到各节点 IP，大幅降低风险 |

---

## 9. 节点上线流程 & 本地模型支持

### 节点 CLI 配置 & 启动
```bash
xllmapi-node start --token ntok_xxx \
  --provider openai_compatible --api-key sk-xxx --base-url https://api.deepseek.com \
  --local-ollama http://localhost:11434 \
  --local-vllm http://localhost:8000
```

### 连接后的三阶段验证流程（关键）

节点连接平台后**不会自动接入网络**，需经过三个阶段：

```
阶段 1: 已连接 (connected)
   → 节点 WS 连接成功，上报 capabilities（可用模型列表）
   → 用户控制台「节点管理」页出现该节点
   → 每个模型状态: 待验证
   → 此时节点仅与用户账户关联，不参与任何网络活动

阶段 2: 已验证 (verified)
   → 平台自动向节点发送测试请求（每个上报的模型各一次）
   → 测试内容: 简单 prompt ("Hello") + 检查响应格式、token 计数、延迟
   → 通过: 模型状态变为已验证
   → 失败: 模型状态变为验证失败（显示失败原因，可重试）
   → 用户也可手动触发重新验证

阶段 3: 可发布 (publishable) → 用户手动操作
   → 只有已验证的模型才可「发布到市场」
   → 用户点击发布:
     - 填写: 定价（input/output per 1k xtokens）、描述、并发上限
     - 提交后创建 offering (execution_mode = 'node', review_status = 'pending')
   → 管理员审核通过 → offering 上线到市场

发布后用户可随时:
   → 暂停/恢复某个模型的网络接入（disable/enable offering）
   → 修改定价
   → 下架模型（offering 标记为 stopped，历史数据和评价保留）
```

### 模型节点唯一标识
每个发布到市场的模型节点拥有一个**全局唯一短 ID**（类似 B 站视频 BV 号）:
- 格式: `mn_` + 8 位 base62（如 `mn_aB3kX9zQ`）
- 用途: URL 路由 (`/market/mn_aB3kX9zQ`)、API 引用、用户分享
- 生命周期: 一旦分配永不复用，即使模型下架 ID 也保留（历史可访问）
- 关联信息: 供应商、模型名、创建时间、累计请求数、评分、评论、收藏数等
- 与 offering 表的 `id` 字段对应（将 offering id 格式改为 `mn_*` 前缀）

### 节点模型状态机
```
待验证(pending_verify) → [平台测试] → 已验证(verified) / 验证失败(verify_failed)
已验证(verified) → [用户发布] → 待审核(pending_review)
待审核(pending_review) → [管理员审核] → 已上线(active) / 审核拒绝(rejected)
已上线(active) → [用户操作] → 已暂停(paused) / 已停止(stopped)
已暂停(paused) → [用户操作] → 已上线(active)
任何状态 → [节点断线] → 离线(offline)（保留原状态，重连后恢复）
```

### 本地模型说明
- Ollama/vLLM 作为 `openai_compatible` provider（都支持 OpenAI 兼容 API）
- 无需 API Key（或使用本地配置的 key）
- 节点在 capabilities 中上报本地模型列表
- 定价由用户自行设定，管理员审核合理性

---

## 10. 包结构

```
packages/
  shared-types/src/
    index.ts              — 扩展: NodeMessage, NodeCapability, extend CandidateOffering
  node-protocol/          — NEW package
    src/
      messages.ts         — WS 消息类型定义
      constants.ts        — 协议版本, 超时常量

apps/
  platform-api/src/
    core/
      node-connection-manager.ts  — NEW: WS 连接管理, 请求分发, 超时控制
    routes/
      node.ts             — EXTEND: 添加 token CRUD, 节点列表, 偏好设置 API
    services/
      platform-service.ts — EXTEND: 节点相关业务逻辑
    repositories/
      platform-repository.ts       — EXTEND: 接口新增节点方法
      postgres-platform-repository.ts — EXTEND: 节点 SQL 实现

  node-cli/               — NEW package
    src/
      main.ts             — CLI 入口 (npx @xllmapi/node)
      ws-client.ts        — WebSocket 客户端
      executor.ts         — LLM 请求执行器
      config.ts           — 本地配置管理
    package.json          — bin: { "xllmapi-node": "./dist/main.js" }
```

---

## 11. DB Schema 变更

```sql
-- 008_node_network.sql

-- 节点认证 Token
CREATE TABLE IF NOT EXISTS node_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hashed_token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',  -- active, revoked
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 节点实例
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL REFERENCES node_tokens(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline',  -- online, offline
  last_heartbeat_at TIMESTAMPTZ,
  capabilities JSONB NOT NULL DEFAULT '[]',
  ip_address TEXT,
  user_agent TEXT,
  connected_at TIMESTAMPTZ,
  reputation_score REAL NOT NULL DEFAULT 1.0,  -- 0.0 - 1.0
  total_requests_served BIGINT NOT NULL DEFAULT 0,
  total_success_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Offerings 扩展
ALTER TABLE offerings ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE offerings ADD COLUMN node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL;

-- 消费者节点偏好
CREATE TABLE IF NOT EXISTS user_node_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  allow_distributed_nodes BOOLEAN NOT NULL DEFAULT FALSE,
  trust_mode TEXT NOT NULL DEFAULT 'all',  -- all, supplier, offering
  trusted_supplier_ids JSONB NOT NULL DEFAULT '[]',
  trusted_offering_ids JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 用户连接池（消费者 opt-in 使用某个 offering）
CREATE TABLE IF NOT EXISTS user_connection_pool (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, offering_id)
);

-- 投票（点赞/点踩）
CREATE TABLE IF NOT EXISTS offering_votes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('upvote', 'downvote')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, offering_id)
);

-- 收藏
CREATE TABLE IF NOT EXISTS offering_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, offering_id)
);

-- 评论
CREATE TABLE IF NOT EXISTS offering_comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_nodes_user_status ON nodes (user_id, status);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes (status);
CREATE INDEX IF NOT EXISTS idx_offerings_node ON offerings (node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offerings_execution_mode ON offerings (execution_mode, logical_model, enabled, review_status);
CREATE INDEX IF NOT EXISTS idx_node_tokens_user ON node_tokens (user_id, status);
CREATE INDEX IF NOT EXISTS idx_offering_votes_offering ON offering_votes (offering_id, vote);
CREATE INDEX IF NOT EXISTS idx_offering_favorites_offering ON offering_favorites (offering_id);
CREATE INDEX IF NOT EXISTS idx_offering_comments_offering ON offering_comments (offering_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_connection_pool_offering ON user_connection_pool (offering_id);
```

---

## 12. API 端点

### 节点管理（供应商侧）
```
POST   /v1/nodes/tokens           — 创建 node token
GET    /v1/nodes/tokens           — 列出我的 tokens
DELETE /v1/nodes/tokens/:id       — 撤销 token
GET    /v1/nodes                  — 列出我的节点 (含在线状态)
GET    /v1/nodes/:id/stats        — 节点统计数据
```

### 消费者偏好 & 连接池
```
GET    /v1/me/node-preferences           — 获取偏好
PUT    /v1/me/node-preferences           — 更新偏好
POST   /v1/me/connection-pool/:offeringId — 加入某 offering 的连接池（opt-in 使用该节点）
DELETE /v1/me/connection-pool/:offeringId — 退出连接池
GET    /v1/me/connection-pool            — 列出已加入的连接池
```

### 模型市场 & 社交互动
```
GET    /v1/market/offerings              — 模型市场列表（分页、筛选、排序，含官方/分布式标签）
GET    /v1/market/offerings/:id          — Offering 详情页数据（指标 + 互动统计 + 我的状态）

POST   /v1/offerings/:id/vote           — 点赞/点踩 { vote: "upvote" | "downvote" }
DELETE /v1/offerings/:id/vote           — 撤销投票
POST   /v1/offerings/:id/favorite       — 收藏
DELETE /v1/offerings/:id/favorite       — 取消收藏

GET    /v1/offerings/:id/comments       — 获取评论列表（分页）
POST   /v1/offerings/:id/comments       — 发表评论 { content: "..." }
DELETE /v1/comments/:commentId          — 删除自己的评论
```
**投票规则**: 每账号每 offering 限一票，可改方向，需至少使用过一次该节点

### 用户主页
```
GET    /v1/users/:handle/profile        — 公开个人主页（发布的 offerings、统计信息）
GET    /v1/users/:handle/offerings      — 用户发布的所有 offerings（含历史/已停止的）
```

### 管理员
```
GET    /v1/admin/nodes            — 所有节点列表
PUT    /v1/admin/nodes/:id        — 管理节点 (禁用/启用)
DELETE /v1/admin/comments/:id     — 管理员删除评论
```

### WebSocket
```
GET    /ws/node                   — 节点 WebSocket 连接端点 (upgrade)
```

---

## 13. 前端页面 — 社交化模型市场

### 模型市场（核心页面，类似视频平台）
- **市场首页** (`/market`): 卡片网格展示所有 offerings
  - 每个卡片 = 一个模型节点（类似视频缩略图）
  - 显示: 模型名、供应商头像+名字、`官方`/`分布式`标签、在线状态灯
  - 指标: 点赞数 / 收藏数 / 使用人数 / 稳定性评分
  - 筛选: 按模型类型、官方/分布式、在线状态、价格区间
  - 排序: 热门、最新、稳定性最高、价格最低
- **Offering 详情页** (`/market/:offeringId`):
  - 顶部: 模型信息、供应商信息（可点击跳转主页）、在线状态
  - 指标面板: 稳定性、延迟、成功率、在线时长、累计服务次数
  - 互动栏: 点赞 / 点踩 / 收藏 / 加入连接池
  - 评论区: 用户评论列表（分页），发表评论框
  - 价格信息: input/output per 1k xtokens

### 用户个人主页 (`/u/:handle`)
- 公开的供应商/消费者资料
- **发布的模型节点列表**: 官方和分布式，标识类型、状态（在线/离线/已停止）
- 统计: 累计服务次数、总服务用户数、平均评分
- 已停止的模型节点也保留展示（灰色显示，保留历史评价）

### 供应商控制台
- **节点管理页** (`/dashboard/nodes`):
  - 创建/撤销 node token（带安装指引）
  - 节点实时在线状态、心跳时间
  - 已连接模型列表，含三阶段状态（待验证/已验证/已发布）
  - 每个节点的请求量、成功率、延迟趋势图
- **消息通知**: 收到点赞/评论/新连接时通知供应商

### 消费者设置
- **连接偏好** (`/settings/nodes`):
  - 全局开关: 允许分布式节点
  - 信任级别: 全部 / 按供应商 / 按 offering
  - 已加入的连接池列表，可管理

### 管理员
- **节点总览** (`/admin/nodes`): 在线节点数、请求分布、异常检测
- **评论审核**: 管理/删除不当评论

---

## 14. 潜在问题 & 应对

| 问题 | 影响 | 应对策略 |
|------|------|----------|
| 家庭网络不稳定 | 节点频繁断线，请求中断 | 120s 超时 + 断路器 + fallback 到其他 offering |
| 节点作弊（虚报 token 数） | 多赚 xtoken | ±30% 交叉校验 + 信誉分下降 + 管理员审查 |
| 节点返回伪造内容 | 消费者体验差 | 消费者举报 + 信誉分体系 |
| 本地模型 token 计数不准 | 结算误差 | 平台侧 tiktoken 估算兜底 |
| WS 消息量过大（高并发） | 平台 WS 服务器压力 | Phase 2 演进到批量传输 |
| 节点地理分布广 | 延迟不可预测 | 展示延迟指标，消费者自主选择 |
| 单节点多请求争抢 | 节点过载 | capabilities 中声明 maxConcurrency，平台侧尊重 |

---

## 15. 演进路线

- **Phase 1** (当前): Thin Relay — 逐 delta 转发，验证概念
- **Phase 2**: Batched Relay — 批量传输 + 协议版本协商，当 WS 消息量成为瓶颈时
- **Phase 3**: Smart Node — 节点自治 + 负载感知路由，当节点规模 > 1000 时
