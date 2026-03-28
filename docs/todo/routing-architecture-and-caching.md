# xllmapi 路由架构设计 — 亲和优先 + 最快响应

## Context

当前路由是纯随机 shuffle，导致两个问题：
1. 上游 LLM 厂商的 prefix cache 永远无法命中（DeepSeek/Anthropic/OpenAI 都要求相同 API Key + 相同 prefix 连续请求）
2. 不考虑各 offering 的实时负载，可能路由到已经很忙的节点

**设计原则：**
- 亲和是"有就用、没有拉倒"，不搞复杂评分公式
- 非亲和时只比一个维度——**谁最快**
- 价格不参与路由（用户加入 pool 时已接受价格）
- 稳定性通过 circuit breaker 硬排除，不参与软排序
- 无需调参，无权重公式

---

## 架构总览

```
                          用户请求 (model=X, conv=abc, user=U)
                                       │
                    ┌──────────────────┴──────────────────┐
                    │          Offering 解析层              │
                    │   resolveOfferings(model, userId)     │
                    │                                      │
                    │   有 pool → pool 中的 offering         │
                    │   无 pool → 平台节点 (不混入分布式)    │
                    │   价格过滤 (maxPrice 配置)             │
                    └──────────────────┬──────────────────┘
                                       │
                              候选 offerings []
                                       │
                    ┌──────────────────┴──────────────────┐
                    │            硬约束筛选层               │
                    │                                      │
                    │   ✗ circuit breaker OPEN → 排除       │
                    │   ✗ 日限额用完 → 排除                 │
                    │   ✗ 预估等待 > 容忍阈值 → 排除        │
                    └──────────────────┬──────────────────┘
                                       │
                              可用 offerings []
                                       │
                    ┌──────────────────┴──────────────────┐
                    │            亲和匹配层                 │
                    │                                      │
                    │   1. convAffinityMap[conv_abc]        │
                    │      → offering_A, 在可用列表中?       │
                    │      → YES → 选 offering_A (cache!)   │
                    │      → NO ↓                          │
                    │                                      │
                    │   2. userAffinityMap[U][X]            │
                    │      → [off_A, off_B], 任一在列表中?   │
                    │      → YES → 选第一个可用的            │
                    │      → NO ↓                          │
                    │                                      │
                    │   3. 按预估总耗时排序                  │
                    │      → top-3 随机选 1                 │
                    └──────────────────┬──────────────────┘
                                       │
                              选中 offering
                                       │
                    ┌──────────────────┴──────────────────┐
                    │           请求队列层                   │
                    │                                      │
                    │   offeringQueue.acquire(requestId)    │
                    │      → 有空位: 立即执行                │
                    │      → 需排队: 等待 (≤ 容忍阈值)      │
                    │      → 超时/满: 重新选下一个           │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │            执行层                     │
                    │                                      │
                    │   platform → LLM API (prefix cache)  │
                    │   node → WebSocket dispatch           │
                    └──────────────────┬──────────────────┘
                                       │
                              成功 / 失败
                                       │
                    ┌──────────────────┴──────────────────┐
                    │           反馈层                      │
                    │                                      │
                    │   成功:                               │
                    │     setConvAffinity(conv, offering)   │
                    │     pushUserAffinity(user, model, ..) │
                    │     recordSuccess (circuit breaker)   │
                    │     updateAvgLatency(offering, ms)    │
                    │     releaseQueueSlot()                │
                    │                                      │
                    │   失败:                               │
                    │     clearConvAffinity(conv)           │
                    │     recordFailure (circuit breaker)   │
                    │     releaseQueueSlot()                │
                    │     → 回到亲和匹配层, 选下一个        │
                    └─────────────────────────────────────┘
```

---

## 模块详细设计

### 模块 1: Offering 解析 (`core/router.ts`)

统一 chat.ts 和 api-proxy.ts 的重复逻辑。

```typescript
export async function resolveOfferings(
  logicalModel: string,
  userId?: string
): Promise<CandidateOffering[]> {
  let offerings: CandidateOffering[];

  if (userId) {
    const pool = await platformService.listConnectionPool(userId);
    if (pool.length > 0) {
      // 用户有 pool → 只用 pool 中的 (平台 + 分布式都可能)
      offerings = await platformService.findUserOfferingsForModel(userId, logicalModel);
    } else {
      // 无 pool → 只走平台节点
      offerings = await platformService.findOfferingsForModel(logicalModel);
      offerings = offerings.filter(o => o.executionMode !== 'node');
    }
  } else {
    // 无 userId → 只走平台节点
    offerings = await platformService.findOfferingsForModel(logicalModel);
    offerings = offerings.filter(o => o.executionMode !== 'node');
  }

  // 价格过滤
  if (userId) {
    const config = await platformService.getUserModelConfig(userId, logicalModel);
    if (config) {
      offerings = offerings.filter(o => {
        if (config.maxInputPrice != null && (o.fixedPricePer1kInput ?? 0) > config.maxInputPrice) return false;
        if (config.maxOutputPrice != null && (o.fixedPricePer1kOutput ?? 0) > config.maxOutputPrice) return false;
        return true;
      });
    }
  }

  return offerings;
}
```

### 模块 2: 硬约束筛选 (`core/router.ts`)

```typescript
async function filterAvailable(offerings: CandidateOffering[]): Promise<CandidateOffering[]> {
  const results: CandidateOffering[] = [];

  for (const o of offerings) {
    // circuit breaker
    if (!isAvailable(o.offeringId)) continue;

    // 日限额
    if (o.dailyTokenLimit && o.dailyTokenLimit > 0) {
      const used = await platformService.getOfferingDailyTokenUsage(o.offeringId);
      if (used >= o.dailyTokenLimit) continue;
    }

    // 预估等待时间检查 (队列满的排除)
    const queue = getOrCreateQueue(o.offeringId, o.maxConcurrency ?? 10);
    if (queue.isFull) continue;

    results.push(o);
  }

  // 如果全被过滤了，退回原始列表 (不拒绝服务)
  return results.length > 0 ? results : offerings;
}
```

### 模块 3: 亲和缓存 (`core/context-affinity.ts`)

#### 对话亲和

```typescript
interface ConvAffinity {
  offeringId: string;
  lastRequestAt: number;
  messageCount: number;
}

const convMap = new Map<string, ConvAffinity>();

const CONV_TTL_MS = 30 * 60 * 1000;  // 30 分钟

export function getConvAffinity(conversationId: string): string | null {
  const entry = convMap.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.lastRequestAt > CONV_TTL_MS) {
    convMap.delete(conversationId);
    return null;
  }
  return entry.offeringId;
}

export function setConvAffinity(
  conversationId: string,
  offeringId: string,
  messageCount: number
): void {
  convMap.set(conversationId, {
    offeringId,
    lastRequestAt: Date.now(),
    messageCount
  });
}

export function clearConvAffinity(conversationId: string): void {
  convMap.delete(conversationId);
}
```

#### 用户模型亲和

```typescript
interface UserOfferingEntry {
  offeringId: string;
  lastUsedAt: number;
  avgLatencyMs: number;
}

// userId → { model → recent offerings (max 3) }
const userMap = new Map<string, Map<string, UserOfferingEntry[]>>();

const USER_TTL_MS = 2 * 60 * 60 * 1000;  // 2 小时
const MAX_RECENT = 3;

export function getUserAffinity(userId: string, model: string): string[] {
  const modelMap = userMap.get(userId);
  if (!modelMap) return [];
  const entries = modelMap.get(model);
  if (!entries) return [];
  const now = Date.now();
  // 过滤过期的
  const valid = entries.filter(e => now - e.lastUsedAt < USER_TTL_MS);
  return valid.map(e => e.offeringId);
}

export function pushUserAffinity(
  userId: string,
  model: string,
  offeringId: string,
  latencyMs: number
): void {
  if (!userMap.has(userId)) userMap.set(userId, new Map());
  const modelMap = userMap.get(userId)!;
  if (!modelMap.has(model)) modelMap.set(model, []);
  const entries = modelMap.get(model)!;

  // 已存在则更新
  const existing = entries.find(e => e.offeringId === offeringId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    // 滑动平均延迟
    existing.avgLatencyMs = Math.round(existing.avgLatencyMs * 0.7 + latencyMs * 0.3);
    return;
  }

  // 新增
  entries.unshift({ offeringId, lastUsedAt: Date.now(), avgLatencyMs: latencyMs });
  // 保留最近 3 个
  if (entries.length > MAX_RECENT) entries.pop();
}
```

#### 定时清理

```typescript
export function startAffinityPruner(): void {
  setInterval(() => {
    const now = Date.now();
    // 清理对话亲和
    for (const [id, entry] of convMap) {
      if (now - entry.lastRequestAt > CONV_TTL_MS) convMap.delete(id);
    }
    // 清理用户亲和
    for (const [userId, modelMap] of userMap) {
      for (const [model, entries] of modelMap) {
        const valid = entries.filter(e => now - e.lastUsedAt < USER_TTL_MS);
        if (valid.length === 0) modelMap.delete(model);
        else modelMap.set(model, valid);
      }
      if (modelMap.size === 0) userMap.delete(userId);
    }
  }, 5 * 60 * 1000); // 每 5 分钟
}
```

### 模块 4: 请求队列 (`core/offering-queue.ts`)

```typescript
class OfferingQueue {
  private active = 0;
  private waiting: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private maxConcurrency: number;
  private maxWaiting: number;
  private latencyHistory: number[] = [];   // 最近 20 次请求延迟

  constructor(maxConcurrency: number, maxWaiting = 20) {
    this.maxConcurrency = maxConcurrency;
    this.maxWaiting = maxWaiting;
  }

  get load(): number {
    return this.maxConcurrency > 0 ? this.active / this.maxConcurrency : 0;
  }

  get pending(): number { return this.waiting.length; }
  get isFull(): boolean { return this.waiting.length >= this.maxWaiting; }

  get avgLatencyMs(): number {
    if (this.latencyHistory.length === 0) return 1000;  // 默认 1s
    return this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
  }

  // 预估等待时间: 排在我前面的请求数 × 平均处理时间
  get estimatedWaitMs(): number {
    if (this.active < this.maxConcurrency) return 0;  // 有空位, 不用等
    return (this.waiting.length + 1) * this.avgLatencyMs;
  }

  // 预估总耗时: 等待 + 处理
  get estimatedTotalMs(): number {
    return this.estimatedWaitMs + this.avgLatencyMs;
  }

  recordLatency(ms: number): void {
    this.latencyHistory.push(ms);
    if (this.latencyHistory.length > 20) this.latencyHistory.shift();
  }

  async acquire(timeoutMs: number): Promise<(() => void) | null> {
    // 有空位, 立即获取
    if (this.active < this.maxConcurrency) {
      this.active++;
      return () => this.release();
    }

    // 队列满了
    if (this.isFull) return null;

    // 排队等待
    return new Promise<(() => void) | null>((resolve) => {
      const timer = setTimeout(() => {
        // 超时, 从等待队列中移除
        const idx = this.waiting.findIndex(w => w.timer === timer);
        if (idx !== -1) this.waiting.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      this.waiting.push({
        resolve: (release) => { clearTimeout(timer); resolve(release); },
        reject: () => { clearTimeout(timer); resolve(null); },
        timer
      });
    });
  }

  private release(): void {
    this.active--;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      this.active++;
      next.resolve(() => this.release());
    }
  }
}

// 全局队列 Map
const queues = new Map<string, OfferingQueue>();

export function getOrCreateQueue(offeringId: string, maxConcurrency: number): OfferingQueue {
  let q = queues.get(offeringId);
  if (!q) {
    q = new OfferingQueue(maxConcurrency);
    queues.set(offeringId, q);
  }
  return q;
}
```

### 模块 5: 亲和匹配 + 最快选择 (`core/router.ts`)

```typescript
// 亲和容忍阈值 (根据对话长度动态调整)
function getAffinityThresholdMs(messageCount: number): number {
  if (messageCount >= 10) return 4000;  // 长对话, cache 价值高
  if (messageCount >= 3) return 3000;
  return 2000;                           // 新对话
}

export async function selectOffering(params: {
  available: CandidateOffering[];
  conversationId?: string;
  userId?: string;
  logicalModel: string;
  messageCount: number;            // 当前对话消息数
}): Promise<{
  offering: CandidateOffering;
  affinityLevel: 'conv' | 'user' | 'load' | 'fallback';
}> {
  const { available, conversationId, userId, logicalModel, messageCount } = params;

  // --- 对话亲和 ---
  if (conversationId) {
    const affinityOfferingId = getConvAffinity(conversationId);
    if (affinityOfferingId) {
      const offering = available.find(o => o.offeringId === affinityOfferingId);
      if (offering) {
        const queue = getOrCreateQueue(offering.offeringId, offering.maxConcurrency ?? 10);
        const threshold = getAffinityThresholdMs(messageCount);
        if (queue.estimatedWaitMs <= threshold) {
          return { offering, affinityLevel: 'conv' };
        }
        // 等太久了, 降级但不清除亲和 (下次可能命中)
      }
    }
  }

  // --- 用户亲和 ---
  if (userId) {
    const recentIds = getUserAffinity(userId, logicalModel);
    for (const id of recentIds) {
      const offering = available.find(o => o.offeringId === id);
      if (offering) {
        const queue = getOrCreateQueue(offering.offeringId, offering.maxConcurrency ?? 10);
        if (queue.estimatedWaitMs <= 1500) {  // 用户亲和阈值更严
          return { offering, affinityLevel: 'user' };
        }
      }
    }
  }

  // --- 按预估总耗时排序, top-3 随机 ---
  const sorted = [...available].sort((a, b) => {
    const qa = getOrCreateQueue(a.offeringId, a.maxConcurrency ?? 10);
    const qb = getOrCreateQueue(b.offeringId, b.maxConcurrency ?? 10);
    return qa.estimatedTotalMs - qb.estimatedTotalMs;
  });

  const topN = sorted.slice(0, Math.min(3, sorted.length));
  const selected = topN[Math.floor(Math.random() * topN.length)];
  return { offering: selected, affinityLevel: 'load' };
}
```

### 模块 6: 完整路由入口 (`core/router.ts`)

```typescript
export async function routeRequest(params: {
  logicalModel: string;
  userId?: string;
  conversationId?: string;
  requestId: string;
  messageCount: number;
}): Promise<{
  offering: CandidateOffering;
  release: () => void;
  affinityLevel: string;
}> {
  // 1. 解析候选
  const candidates = await resolveOfferings(params.logicalModel, params.userId);
  if (candidates.length === 0) {
    throw new Error(`no offering available for ${params.logicalModel}`);
  }

  // 2. 硬约束筛选
  const available = await filterAvailable(candidates);

  // 3. 选择 (亲和 → 最快)
  const { offering, affinityLevel } = await selectOffering({
    available,
    conversationId: params.conversationId,
    userId: params.userId,
    logicalModel: params.logicalModel,
    messageCount: params.messageCount,
  });

  // 4. 获取队列槽位
  const queue = getOrCreateQueue(offering.offeringId, offering.maxConcurrency ?? 10);
  const thresholdMs = affinityLevel === 'conv'
    ? getAffinityThresholdMs(params.messageCount)
    : affinityLevel === 'user' ? 1500 : 3000;

  const release = await queue.acquire(thresholdMs);
  if (release) {
    return { offering, release, affinityLevel };
  }

  // 5. 获取失败, 从剩余候选中选下一个 (fallback)
  const remaining = available.filter(o => o.offeringId !== offering.offeringId);
  if (remaining.length > 0) {
    const fallback = remaining[Math.floor(Math.random() * remaining.length)];
    const fbQueue = getOrCreateQueue(fallback.offeringId, fallback.maxConcurrency ?? 10);
    const fbRelease = await fbQueue.acquire(5000);
    if (fbRelease) {
      return { offering: fallback, release: fbRelease, affinityLevel: 'fallback' };
    }
  }

  // 6. 最终兜底: 不排队直接执行
  return { offering, release: () => {}, affinityLevel: 'fallback' };
}

// 请求完成后调用
export function recordRouteResult(params: {
  success: boolean;
  conversationId?: string;
  userId?: string;
  logicalModel: string;
  offeringId: string;
  messageCount: number;
  latencyMs: number;
}): void {
  const queue = getOrCreateQueue(params.offeringId, 10);

  if (params.success) {
    queue.recordLatency(params.latencyMs);
    recordSuccess(params.offeringId);

    if (params.conversationId) {
      setConvAffinity(params.conversationId, params.offeringId, params.messageCount);
    }
    if (params.userId) {
      pushUserAffinity(params.userId, params.logicalModel, params.offeringId, params.latencyMs);
    }
  } else {
    recordFailure(params.offeringId);
    if (params.conversationId) {
      clearConvAffinity(params.conversationId);
    }
  }
}
```

---

## 内存数据结构全景

```
┌─────────────────────────────────────────────────────────────┐
│                    路由状态 (全内存, 不持久化)                 │
│                                                             │
│  convAffinityMap: Map<conversationId, ConvAffinity>         │
│  ┌─────────────────────────────────────────────┐            │
│  │ conv_abc → off_A, lastReq=14:32, msgs=8     │            │
│  │ conv_def → off_C, lastReq=14:28, msgs=3     │            │
│  │ conv_ghi → off_A, lastReq=14:15, msgs=15    │            │
│  └─────────────────────────────────────────────┘            │
│  TTL: 30 分钟                                               │
│                                                             │
│  userAffinityMap: Map<userId, Map<model, Entry[]>>          │
│  ┌─────────────────────────────────────────────┐            │
│  │ user_123:                                    │            │
│  │   deepseek-chat → [off_A (200ms), off_B (350ms)]│        │
│  │   gpt-4o        → [off_C (180ms)]            │            │
│  │ user_456:                                    │            │
│  │   deepseek-chat → [off_B (300ms)]            │            │
│  └─────────────────────────────────────────────┘            │
│  TTL: 2 小时, 每 model 最多 3 个                             │
│                                                             │
│  offeringQueues: Map<offeringId, OfferingQueue>             │
│  ┌─────────────────────────────────────────────┐            │
│  │ off_A → active=3/10, wait=0, avgLat=200ms    │            │
│  │ off_B → active=8/10, wait=2, avgLat=350ms    │            │
│  │ off_C → active=0/5,  wait=0, avgLat=180ms    │            │
│  └─────────────────────────────────────────────┘            │
│  延迟历史: 最近 20 次, 滑动窗口                               │
│                                                             │
│  circuitBreakers: Map<offeringId, BreakerState> (已有)       │
│  ┌─────────────────────────────────────────────┐            │
│  │ off_A → closed, 0 failures                   │            │
│  │ off_B → half-open, 3 failures, cooldown 30s  │            │
│  └─────────────────────────────────────────────┘            │
│                                                             │
│  不持久化原因:                                               │
│  - 厂商 cache TTL 5-10分钟, 重启后 cache 已过期              │
│  - 亲和/队列/延迟都是实时状态, 冷启动几次请求后即可重建       │
└─────────────────────────────────────────────────────────────┘
```

---

## 调用方接入

### chat.ts 改动

```typescript
// 删除: findOfferingsIncludingNodes, getAllOfferings (约 80 行)
// 替换为:

import { routeRequest, recordRouteResult } from '../core/router.js';

// 在 stream handler 中:
const history = await platformService.listChatMessages({ ... });
const messageCount = history.length + 1;

const route = await routeRequest({
  logicalModel,
  userId: auth.userId,
  conversationId,
  requestId,
  messageCount
});

console.log(`[chat] requestId=${requestId} → ${route.offering.offeringId} (${route.affinityLevel})`);

try {
  const result = await executeStreamingRequest({
    requestId,
    offerings: [route.offering],  // 单个 offering, 不再传整个列表
    messages: contextMessages,
    ...
  });

  recordRouteResult({
    success: true,
    conversationId,
    userId: auth.userId,
    logicalModel,
    offeringId: route.offering.offeringId,
    messageCount,
    latencyMs: result.timing.totalMs
  });
} catch (err) {
  recordRouteResult({ success: false, ... });
  // retry: 再次调用 routeRequest (亲和已清除, 会选其他 offering)
} finally {
  route.release();
}
```

### api-proxy.ts 改动

同样删除重复路由代码，接入 `routeRequest`。无 `conversationId`（API 模式无对话状态），只走用户亲和 + 最快选择。

### provider-executor.ts 改动

`executeStreamingRequest` 的 `offerings` 参数从数组改为**单个 offering**（路由层已经选好了）。如果执行失败，由调用方（chat.ts）决定是否 retry（再次调用 routeRequest）。

这样 provider-executor 变成纯执行层，不参与选择逻辑。

---

## 可观测性

### Prometheus 指标

```
# 路由级别分布
xllmapi_route_level_total{level="conv|user|load|fallback"} counter

# 亲和命中率 (conv + user 命中 / 总请求)
xllmapi_route_affinity_hit_ratio gauge

# 每个 offering 的队列状态
xllmapi_offering_queue_active{offering_id} gauge
xllmapi_offering_queue_pending{offering_id} gauge
xllmapi_offering_queue_latency_avg_ms{offering_id} gauge

# 预估等待导致的亲和降级次数
xllmapi_route_affinity_degraded_total{reason="wait_exceeded"} counter
```

### 日志

```
[router] req=xxx conv=abc → conv_affinity off_A (wait=0ms, msgs=8)
[router] req=yyy conv=def → user_affinity off_B (wait=200ms, deepseek-chat)
[router] req=zzz → load_select off_C (estimatedTotal=180ms, top3=[C,A,D])
[router] req=www conv=ghi → conv_affinity DEGRADED off_A wait=4200ms > threshold=3000ms → load_select off_C
```

---

## 上游 Cache 命中效果预估

```
场景: 用户在 conv_abc 连续 10 轮对话, model=deepseek-chat

无亲和 (当前随机路由):
  每轮随机选 offering → 每次都是新的 API Key 或新节点
  → DeepSeek prefix cache 命中率 ≈ 0%
  → 10 轮累计 input: 27500 tokens, 全价 2.75 分

有亲和 (本方案):
  conv 亲和锁定 offering_A → 每次同一 API Key
  → DeepSeek 自动 prefix cache, 第 2 轮起命中
  → 10 轮累计: 5000 new + 22500 cached
  → 费用: 5000 × 1元/M + 22500 × 0.1元/M = 0.725 分
  → 节省 73%
```

---

## 实施阶段

| 阶段 | 内容 | 新文件 |
|------|------|--------|
| **A** | `core/context-affinity.ts` — 亲和缓存 + 清理 | 新建 |
| **B** | `core/offering-queue.ts` — Per-offering 队列 | 新建 |
| **C** | `core/router.ts` — resolveOfferings + filterAvailable + selectOffering + routeRequest | 新建 |
| **D** | chat.ts — 删除旧路由, 接入 routeRequest | 改造 |
| **E** | api-proxy.ts — 同上 | 改造 |
| **F** | provider-executor.ts — offerings 参数改为单个 | 改造 |
| **G** | metrics.ts — 路由指标 | 扩展 |

A+B 无依赖可并行, C 依赖 A+B, D+E+F 依赖 C。
