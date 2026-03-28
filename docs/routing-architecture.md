# xllmapi 路由架构 — 亲和优先 + 最快响应

## 设计原则

- 亲和是"有就用、没有拉倒"，不搞复杂评分公式
- 非亲和时只比一个维度——谁最快
- 价格不参与路由（用户加入 pool 时已接受价格）
- 稳定性通过 circuit breaker 硬排除，不参与软排序
- 无需调参，无权重公式

## 架构总览

```
                    用户请求 (model=deepseek-chat, conv=abc, user=U)
                                        │
                ┌───────────────────────┴───────────────────────┐
                │              Offering 解析层                    │
                │         resolveOfferings(model, userId)         │
                │                                                │
                │   ┌─ 有 connection_pool?                        │
                │   │   YES → pool 中该模型的 offering             │
                │   │   NO  → 全部平台节点 (过滤掉分布式)          │
                │   └─ 价格过滤 (用户 maxPrice 配置)              │
                └───────────────────────┬───────────────────────┘
                                        │
                               候选 [off_A, off_B, off_C, off_D]
                                        │
                ┌───────────────────────┴───────────────────────┐
                │              硬约束筛选层                       │
                │                                                │
                │   off_A: circuit breaker OPEN    → ✗ 排除       │
                │   off_B: 日限额用完              → ✗ 排除       │
                │   off_C: 队列已满 (20 pending)   → ✗ 排除       │
                │   off_D: 正常                    → ✓ 保留       │
                │                                                │
                │   全部被过滤 → 退回原始列表 (不拒绝服务)         │
                └───────────────────────┬───────────────────────┘
                                        │
                               可用 [off_D, ...]
                                        │
      ┌─────────────────────────────────┴─────────────────────────────────┐
      │                         亲和匹配层                                 │
      │                                                                   │
      │   ┌─ Level 1: 对话亲和                                            │
      │   │   convAffinityMap[conv_abc] → off_X                           │
      │   │   off_X 在可用列表? → YES                                     │
      │   │   预估等待 ≤ 阈值(消息数)?                                     │
      │   │     msgs≥10: ≤4s  │  msgs≥3: ≤3s  │  msgs<3: ≤2s             │
      │   │   → YES → 选 off_X                          ← cache 命中!    │
      │   │   → NO  → 降级 ↓                                             │
      │   │                                                               │
      │   ├─ Level 2: 用户亲和                                            │
      │   │   userAffinityMap[U][deepseek-chat] → [off_Y, off_Z]         │
      │   │   遍历: off_Y 可用且预估等待 ≤ 1.5s?                          │
      │   │   → YES → 选 off_Y                          ← 可能有 cache   │
      │   │   → NO  → 降级 ↓                                             │
      │   │                                                               │
      │   └─ Level 3: 最快响应                                            │
      │       按 estimatedTotalMs 排序 (等待时间 + 平均延迟)               │
      │       同分随机打散 (防雷群)                                        │
      │       top-3 中随机选 1                           ← 选最快的       │
      └─────────────────────────────────┬─────────────────────────────────┘
                                        │
                               选中 offering + affinityLevel
                                        │
                ┌───────────────────────┴───────────────────────┐
                │              请求队列层                         │
                │                                                │
                │   OfferingQueue(maxConcurrency, maxWaiting=20) │
                │                                                │
                │   有空位 → 立即执行                             │
                │   需排队 → 等待 (≤ 亲和阈值 / 1.5s / 3s)       │
                │   超时/满 → fallback 选下一个 offering          │
                └───────────────────────┬───────────────────────┘
                                        │
                ┌───────────────────────┴───────────────────────┐
                │                执行层                           │
                │                                                │
                │   platform offering → LLM API                  │
                │     (同 API Key + 同 prefix → cache 命中)       │
                │                                                │
                │   node offering → WebSocket dispatch            │
                │     (同节点连续服务 → 本地 KV cache)             │
                └───────────────────────┬───────────────────────┘
                                        │
                                   成功 / 失败
                                        │
      ┌─────────────────────────────────┴─────────────────────────────────┐
      │                         反馈层                                     │
      │                                                                   │
      │   成功:                              失败:                         │
      │     setConvAffinity(conv, off)         clearConvAffinity(conv)     │
      │     pushUserAffinity(user, model)      recordFailure (breaker)    │
      │     recordSuccess (breaker)            releaseQueueSlot()         │
      │     queue.recordLatency(ms)            → 重新路由, 选下一个        │
      │     releaseQueueSlot()                                            │
      └───────────────────────────────────────────────────────────────────┘
```

---

## 各阶段详细匹配逻辑

### 阶段 1: Offering 解析

**入口:** `resolveOfferings(logicalModel, userId)`

**匹配流程:**

1. 检查用户是否有 `connection_pool`（`offering_favorites` 表）
   - **有 pool**: 调用 `findUserOfferingsForModel(userId, model)` — 只返回 pool 中匹配该模型、且 `enabled=true` + `review_status=approved` 的 offering（包含平台和分布式节点）
   - **无 pool**: 调用 `findOfferingsForModel(model)` — 返回全部匹配的 offering，然后过滤掉 `executionMode='node'` 的分布式节点（分布式节点必须显式加入 pool 才会被路由）

2. 价格过滤: 读取 `user_model_config` 表中用户对该模型的 `maxInputPrice` / `maxOutputPrice` 配置，过滤超出价格上限的 offering

**SQL 核心查询:**
```sql
SELECT o.*, c.base_url, c.encrypted_secret, ...
FROM offerings o
LEFT JOIN provider_credentials c ON c.id = o.credential_id
WHERE o.logical_model = $1
  AND o.enabled = TRUE
  AND o.review_status = 'approved'
  AND (c.status = 'active' OR o.credential_id IS NULL)
```

### 阶段 2: 硬约束筛选

**入口:** `filterAvailable(offerings)`

**逐个 offering 检查:**

1. **Circuit Breaker** (`isAvailable(offeringId)`)
   - `closed` (正常) → 通过
   - `open` (连续 3 次失败) → 排除，30 秒冷却后进入 `half-open`
   - `half-open` → 允许 1 次探测请求通过

2. **日限额** (`getOfferingDailyTokenUsage(offeringId)`)
   - offering 配置了 `dailyTokenLimit` 且当日已用 token 数 ≥ 限额 → 排除
   - 未配置限额或未超 → 通过

3. **队列容量** (`queue.isFull`)
   - 排队等待数 ≥ `maxWaiting`(20) → 排除
   - 否则 → 通过

**兜底:** 如果所有 offering 都被过滤，退回原始列表（不拒绝服务）

### 阶段 3: 亲和匹配

**入口:** `selectOffering({ available, conversationId, userId, logicalModel, messageCount })`

**Level 1 — 对话亲和 (conv affinity):**

```
查询: convAffinityMap.get(conversationId) → offeringId
条件: offeringId 在可用列表中 AND queue.estimatedWaitMs ≤ 阈值
阈值:
  消息数 ≥ 10 → 4000ms (长对话, prefix cache 价值高, 值得等)
  消息数 ≥ 3  → 3000ms (中等对话)
  消息数 < 3  → 2000ms (新对话, cache 价值低)
命中 → 返回 { offering, affinityLevel: 'conv' }
未命中 → 降级到 Level 2 (不清除亲和记录, 下次可能命中)
```

**Level 2 — 用户亲和 (user affinity):**

```
查询: userAffinityMap.get(userId).get(model) → [offeringId1, offeringId2, ...]
      按 lastUsedAt 降序, 最多 3 个, 过滤 TTL 2 小时内的
条件: offeringId 在可用列表中 AND queue.estimatedWaitMs ≤ 1500ms (更严格)
命中 → 返回 { offering, affinityLevel: 'user' }
未命中 → 降级到 Level 3
```

**Level 3 — 最快响应 (load-based):**

```
计算每个 offering 的 estimatedTotalMs:
  estimatedTotalMs = estimatedWaitMs + avgLatencyMs
  estimatedWaitMs = 有空位? 0 : (排队数 + 1) × avgLatencyMs
  avgLatencyMs = 最近 20 次请求的滑动平均延迟 (默认 1000ms)

排序: 按 estimatedTotalMs 升序, 同分随机打散
选择: top-3 中随机选 1 (防雷群效应)
返回: { offering, affinityLevel: 'load' }
```

### 阶段 4: 请求队列

**入口:** `queue.acquire(timeoutMs)`

**Per-Offering 队列参数:**
- `maxConcurrency`: 来自 offering 配置，默认 10
- `maxWaiting`: 20 (超过则 isFull，硬约束层已排除)
- `timeoutMs`: 由亲和级别决定
  - conv affinity → `getAffinityThresholdMs(messageCount)` (2-4s)
  - user affinity → 1500ms
  - load → 3000ms

**获取槽位:**
- 活跃 < maxConcurrency → 立即获取，返回 release 函数
- 排队 → Promise 等待，超时返回 null
- 返回 null → 路由层 fallback 到其他 offering

### 阶段 5: 执行

由 `provider-executor.ts` 处理，路由层传入**单个 offering**（不再传整个列表）。

- **platform offering:** HTTPS 请求 LLM API，同一 API Key + 同 prefix → 上游自动 prefix cache
- **node offering:** WebSocket dispatch 到分布式节点，同节点连续服务 → 本地 KV cache

### 阶段 6: 反馈

**入口:** `recordRouteResult({ success, conversationId, userId, logicalModel, offeringId, messageCount, latencyMs })`

**成功时:**
- `setConvAffinity(conv, offering, messageCount)` — 建立/更新对话亲和，下次请求优先此 offering
- `pushUserAffinity(user, model, offering, latency)` — 更新用户亲和队列（最多 3 个，滑动平均延迟 `0.7 × old + 0.3 × new`）
- `recordSuccess(offeringId)` — circuit breaker 重置
- `queue.recordLatency(ms)` — 更新延迟历史（最近 20 次）

**失败时:**
- `clearConvAffinity(conv)` — 清除对话亲和（下次会选其他 offering）
- `recordFailure(offeringId)` — circuit breaker 计数（3 次后 open）
- 调用方重新调用 `routeRequest` → 亲和已清除，会选其他 offering

---

## 延时分析

```
                    用户请求 (model=deepseek-chat, conv=abc, user=U)
                                        │
                                        │  ~0ms (内存读取)
                                        ▼
                ┌───────────────────────────────────────────────┐
                │              Offering 解析层                    │
                │                                                │
                │   listConnectionPool → DB 查询                  │  ⏱ 1-5ms
                │   findOfferingsForModel → DB 查询               │  ⏱ 2-10ms
                │   getUserModelConfig → DB 查询                  │  ⏱ 1-3ms
                │                                                │
                │                              总计 ⏱ 3-15ms     │
                └───────────────────────┬───────────────────────┘
                                        │
                                        ▼
                ┌───────────────────────────────────────────────┐
                │              硬约束筛选层                       │
                │                                                │
                │   isAvailable → 内存 Map 查询                   │  ⏱ <0.01ms
                │   getOfferingDailyTokenUsage → DB 查询          │  ⏱ 2-5ms/个
                │   queue.isFull → 内存查询                       │  ⏱ <0.01ms
                │                                                │
                │                              总计 ⏱ 2-20ms     │
                │                        (取决于候选数量)          │
                └───────────────────────┬───────────────────────┘
                                        │
                                        ▼
                ┌───────────────────────────────────────────────┐
                │              亲和匹配层                         │
                │                                                │
                │   getConvAffinity → 内存 Map                    │  ⏱ <0.01ms
                │   getUserAffinity → 内存 Map                    │  ⏱ <0.01ms
                │   queue.estimatedWaitMs → 内存计算              │  ⏱ <0.01ms
                │   sort + top-3 random → 内存计算                │  ⏱ <0.01ms
                │                                                │
                │                              总计 ⏱ <0.1ms     │
                └───────────────────────┬───────────────────────┘
                                        │
                                        ▼
                ┌───────────────────────────────────────────────┐
                │              请求队列层                         │
                │                                                │
                │   有空位 → 立即                                 │  ⏱ 0ms
                │   排队 (亲和命中, 长对话)                        │  ⏱ ≤4000ms
                │   排队 (用户亲和)                                │  ⏱ ≤1500ms
                │   排队 (负载选择)                                │  ⏱ ≤3000ms
                │                                                │
                │                     通常 ⏱ 0ms (空闲时)        │
                └───────────────────────┬───────────────────────┘
                                        │
                                        ▼
                ┌───────────────────────────────────────────────┐
                │                执行层                           │
                │                                                │
                │   platform → HTTPS 请求 LLM API                │
                │     首 token (TTFT): 500ms - 2000ms             │
                │     流式传输: 1000ms - 30000ms                  │
                │     prefix cache 命中时 TTFT 降低 30-50%        │
                │                                                │
                │   node → WebSocket dispatch                    │
                │     节点接收: 10-50ms                            │
                │     节点调 LLM: 500ms - 30000ms                 │
                │                                                │
                │                     总计 ⏱ 500ms - 30s         │
                └───────────────────────┬───────────────────────┘
                                        │
                                        ▼
                ┌───────────────────────────────────────────────┐
                │              反馈层                             │
                │                                                │
                │   setConvAffinity → 内存写入                    │  ⏱ <0.01ms
                │   pushUserAffinity → 内存写入                   │  ⏱ <0.01ms
                │   queue.recordLatency → 内存写入                │  ⏱ <0.01ms
                │   recordSuccess → 内存写入                      │  ⏱ <0.01ms
                │   releaseQueueSlot → 内存操作                   │  ⏱ <0.01ms
                │                                                │
                │                              总计 ⏱ <0.1ms     │
                └───────────────────────────────────────────────┘
```

### 延时汇总

| 阶段 | 最快 | 典型 | 最慢 | 存储类型 |
|------|------|------|------|---------|
| Offering 解析 | 3ms | 8ms | 15ms | DB (PostgreSQL) |
| 硬约束筛选 | 0.01ms | 5ms | 20ms | 内存 + DB |
| 亲和匹配 | 0.01ms | 0.05ms | 0.1ms | 纯内存 |
| 请求队列 | 0ms | 0ms | 4000ms | 纯内存 |
| 执行 (LLM) | 500ms | 2000ms | 30000ms | 网络 I/O |
| 反馈 | 0.01ms | 0.05ms | 0.1ms | 纯内存 |
| **路由开销 (不含执行和排队)** | **~3ms** | **~13ms** | **~35ms** | |
| **端到端** | **~503ms** | **~2013ms** | **~34035ms** | |

**路由层开销 ~13ms，占端到端 ~0.6%，瓶颈完全在执行层（LLM API 延迟）。**

---

## 内存状态

```
  convAffinityMap                  userAffinityMap                 offeringQueues
  ┌──────────────────┐             ┌──────────────────┐            ┌──────────────────┐
  │ conv_abc → off_D  │             │ user_U:           │            │ off_A: 3/10      │
  │   lastReq: 14:32  │             │   ds-chat:        │            │   wait=0         │
  │   msgs: 8         │             │     off_D (200ms) │            │   avgLat=200ms   │
  │                   │             │     off_E (350ms) │            │                  │
  │ conv_def → off_E  │             │   gpt-4o:         │            │ off_B: 8/10      │
  │   lastReq: 14:28  │             │     off_F (180ms) │            │   wait=2         │
  │   msgs: 3         │             │                   │            │   avgLat=350ms   │
  └──────────────────┘             └──────────────────┘            └──────────────────┘
  TTL: 30 分钟                      TTL: 2 小时                     延迟: 最近 20 次
                                    每 model 最多 3 个
```

全内存，不持久化。进程重启后冷启动，几次请求后自动重建。这是合理的——上游厂商 cache TTL 5-10 分钟，重启后 cache 也已过期。

---

## 上游 Cache 命中效果

| 厂商 | Cache 类型 | 触发条件 | 节省 | TTL |
|------|-----------|---------|------|-----|
| DeepSeek | 自动 prefix cache | 同 API Key + 同 prefix ≥64 tokens | cached token 降 90% | ~5-10 分钟 |
| Anthropic | Prompt Caching | cache_control + 同 prefix | cached 降 90% | 5 分钟 |
| OpenAI | 自动 Prompt Caching | 同 prefix ≥1024 tokens | cached 降 50% | ~5-10 分钟 |
| Ollama/本地 | KV Cache | 同模型实例 + 同 prefix | 免费 | 进程存活期 |

**示例: 10 轮对话 (DeepSeek)**

```
无亲和 (随机路由):
  每轮不同 offering → prefix cache 命中率 ≈ 0%
  10 轮累计 input: 27500 tokens, 全价 2.75 分

有亲和 (本方案):
  conv 亲和锁定同一 offering → 第 2 轮起 cache 命中
  10 轮累计: 5000 new + 22500 cached
  费用: 5000 × 1元/M + 22500 × 0.1元/M = 0.725 分
  节省 73%
```

---

## 源码位置

| 模块 | 文件 |
|------|------|
| 统一路由入口 | `apps/platform-api/src/core/router.ts` |
| 亲和缓存 | `apps/platform-api/src/core/context-affinity.ts` |
| 请求队列 | `apps/platform-api/src/core/offering-queue.ts` |
| Circuit Breaker | `packages/core/src/resilience/circuit-breaker.ts` |
| 执行层 | `apps/platform-api/src/core/provider-executor.ts` |
| 路由测试 | `apps/platform-api/src/tests/router.test.ts` |
