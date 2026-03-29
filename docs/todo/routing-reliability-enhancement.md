# 路由可靠性增强方案

> 设计文档 — 2026-03-30

## 背景

### 触发事件

Kimi Coding 某供应商 API Key 配额用完（5H 周期限制，403），平台持续将请求路由到该 offering，没有 fallback 到另一个可用供应商。同时失败请求在管理员界面无任何记录。

### 根因分析

1. **Chat 路径无 fallback** — `routeRequest()` 选 1 个 offering 传给 executor，失败就挂
2. **熔断不区分错误类型** — 配额用完 30s 后又探测，必然再失败，循环往复
3. **熔断全量 fallback** — 全部熔断时返回全部，熔断形同虚设
4. **失败请求无记录** — 管理员看不到任何失败请求
5. **管理员无法查看系统日志** — 排障只能 SSH 看 PM2 文件

---

## 设计方案

### 一、错误三级分类 + Cooldown + 优先级组合

#### 1.1 错误分级

| 级别 | 触发条件 | 策略 | 恢复方式 |
|------|---------|------|---------|
| **transient** (临时) | 网络超时、500、429 | 3 次 → open，指数 cooldown（30s 起步，上限 10min） | 自动 half-open 探测 |
| **degraded** (降级) | 403 配额用完（5H 周期限制等）| 1 次立即 open，cooldown 递增 | 自动递增探测 + 管理员手动重置 |
| **fatal** (致命) | 401 key 失效、403 UA 拒绝 | 1 次立即 `disabled` | **仅**管理员手动重置 |

#### 1.2 指数 Cooldown 策略（degraded 级别）

**指数递增公式：** `cooldown = min(baseDelay × 2^(consecutiveFailures - 1), maxDelay)`

**transient 级别：** baseDelay = 30s，maxDelay = 10min（需先触发 3 次才 open）

```
第 1 次 open → 30s 后探测
第 2 次 open → 1 分钟后探测
第 3 次 open → 2 分钟后探测
第 4 次 open → 4 分钟后探测
第 5+ 次     → 10 分钟后探测（上限）
```

**degraded 级别：** baseDelay = 10min，maxDelay = 24h（1 次即 open）

```
第 1 次降级 → 10 分钟后探测
第 2 次降级 → 20 分钟后探测
第 3 次降级 → 40 分钟后探测
第 4 次降级 → 80 分钟后探测 (~1.3h)
第 5 次降级 → 160 分钟后探测 (~2.7h)
第 6 次降级 → 320 分钟后探测 (~5.3h)
第 7+ 次    → 24 小时后探测（上限）
```

**自动暂停 + 通知机制：**

当一个 offering 连续降级达到阈值且跨越一定时间仍未恢复时，自动暂停并通知供应商：

```
连续降级 >= 10 次 且 持续时间 >= 7 天
  → 自动将 offering.enabled 设为 false（与用户手动停用一致）
  → 发送平台系统通知（站内通知，用户登录后可见）
  → 发送邮件通知 offering owner
  → 管理员界面显示"已自动停用"标记

通知内容（站内 + 邮件）：
  "你提供的模型 {logicalModel} 因持续出错（{errorMessage}）
   已被平台自动停用。请检查你的 API Key 配额或配置，
   修复后到 控制台 → 模型管理 重新启用。"
```

不引入新的 `disabled` 状态区分，直接复用 `offering.enabled = false`（与用户手动停用行为一致）。熔断器的 `disabled` 状态仅用于内存级路由排除，DB 层面就是 `enabled=false`。

**恢复路径：**
- 探测成功（配额自动刷新）→ 立即恢复 closed，重置所有计数器
- 管理员手动重置 → 立即恢复 closed
- 供应商在控制台重新启用 → 恢复 closed

#### 1.3 错误识别规则

```typescript
function classifyError(status: number, body: string): "transient" | "degraded" | "fatal" {
  if (status === 401) return "fatal";                          // key 失效
  if (status === 403) {
    if (body.includes("usage limit") || body.includes("quota")) return "degraded";  // 配额
    if (body.includes("only available for")) return "fatal";   // UA/agent 限制
    return "degraded";                                          // 其他 403 默认降级
  }
  if (status === 429) return "transient";                      // 速率限制
  if (status >= 500) return "transient";                       // 服务端错误
  return "transient";                                           // 其他默认临时
}
```

#### 1.4 优先级权重

offering 选择时加入健康度权重，避免把请求送到半死不活的节点：

```
选择优先级 = 健康度 × 亲和匹配

健康度:
  closed (正常)       → 1.0    正常参与选择
  half-open (探测中)   → 0.3    有其他健康节点时不选它
  open (熔断冷却中)    → 0.0    排除
  disabled (已禁用)    → 0.0    排除，仅管理员手动恢复
```

在 `filterAvailable` 和 `selectOffering` 中同时生效：
- `filterAvailable`：排除 open 和 disabled，保留 closed 和 half-open
- `selectOffering`：closed 的 offering 优先于 half-open 的

#### 1.5 全部不可用时的行为

```
改前：全部不可用 → 返回全部（熔断无效）
改后：
  有 half-open 的 → 只返回 half-open 的（探测）
  全部 open/disabled → 返回明确错误："所有供应商暂时不可用，请稍后重试"

  不再静默地把用户的请求送给必然失败的节点。
```

### 二、统一 Executor Fallback

#### 2.1 统一两条路径

```
改前：
  Chat:  routeRequest() → 选1个 → executor([1个]) → 失败就挂
  Proxy: resolveAll() → executor([全部]) → 逐个 fallback

改后（统一）：
  Chat:  routeRequest() → 选1个首选 + 返回全部候选
         → executor([全部候选], preferred=首选)
         → 优先首选 → 失败 → 自动 fallback 下一个

  Proxy: resolveAll() → executor([全部])
         → 不变
```

#### 2.2 具体改动

**`router.ts` — `routeRequest` 返回 `candidates`**

```typescript
export async function routeRequest(params): Promise<{
  offering: CandidateOffering;
  candidates: CandidateOffering[];   // ← 新增：全部候选
  release: () => void;
  affinityLevel: AffinityLevel;
}>
```

**`provider-executor.ts` — `executeStreamingRequest` 支持 preferred**

```typescript
export async function executeStreamingRequest(params: {
  offerings: CandidateOffering[];
  preferredOfferingId?: string;     // ← 新增：首选
  // ...existing
}): Promise<ProviderResult> {
  // 首选排在前面，其余 shuffle
  const ordered = preferredOfferingId
    ? [preferred, ...rest.shuffle()]
    : shuffle(all);

  for (const offering of ordered) {
    // ... existing try/catch with fallback to next
  }
}
```

**`chat.ts` — 传入全部候选**

```typescript
const result = await executeStreamingRequest({
  offerings: route.candidates,                    // ← 全部候选
  preferredOfferingId: route.offering.offeringId,  // ← 首选 hint
  // ...existing params
});
```

### 三、熔断器状态扩展

#### 3.1 数据结构

```typescript
interface BreakerState {
  failures: number;
  lastFailureAt: number;
  state: "closed" | "open" | "half-open" | "disabled";
  errorClass: "transient" | "degraded" | "fatal" | null;
  cooldownMs: number;              // 当前 cooldown（指数递增）
  degradedCount: number;           // degraded 连续次数（用于指数计算）
  firstDegradedAt: number;         // 首次降级时间（用于判断是否跨7天）
  lastErrorMessage?: string;       // 最后一次错误信息（管理员查看）
  autoDisabled?: boolean;          // 是否被自动暂停（区分手动禁用）
}
```

**自动暂停判断逻辑（在 half-open 探测失败时检查）：**

```typescript
function checkAutoDisable(s: BreakerState, offeringId: string): boolean {
  if (s.degradedCount >= 10 && Date.now() - s.firstDegradedAt >= 7 * 24 * 3600 * 1000) {
    s.state = "disabled";
    s.autoDisabled = true;
    // 触发通知（异步，不阻塞请求）
    notifyOfferingOwner(offeringId, s.lastErrorMessage);
    return true;
  }
  return false;
}
```

#### 3.2 状态转换

```
closed ──失败(transient)──→ failures++ ──超过3次──→ open (30s cooldown)
closed ──失败(degraded)──→ open (1min cooldown, 指数递增)
closed ──失败(fatal)──→ disabled (不自动恢复)

open ──cooldown 过期──→ half-open ──探测成功──→ closed (reset all counters)
                                  ──探测失败(transient)──→ open (30s)
                                  ──探测失败(degraded)──→ open (cooldown × 2)
                                    └─ 连续 >= 10 次 且 >= 7 天未恢复
                                       → disabled (自动暂停)
                                       → 通知 offering owner

disabled ──管理员手动重置──→ closed
disabled ──供应商重新启用──→ closed

half-open ──有其他 closed 的 offering 时──→ 被降权（权重 0.3），不优先选
```

#### 3.3 管理员操作

**新增 API：**
- `GET /v1/admin/offering-health` — 查看所有 offering 的熔断状态
- `POST /v1/admin/offering-health/:offeringId/reset` — 手动重置（closed）
- `POST /v1/admin/offering-health/:offeringId/disable` — 手动禁用

**管理员侧边栏：** 新增"模型节点"分段，将模型审核移入，新增节点状态和节点配置页面。

```
管理
  总览
  用户管理
  邀请管理
  平台用量
  请求明细
  结算记录
  结算失败

模型节点                    ← 新分段
  模型审核                  ← 从"管理"段移入
  节点状态                  ← 新增：offering 健康度、熔断状态、自动停用标记
  节点配置                  ← 新增：cooldown 参数查看（只读）

系统
  供应商
  系统设置
  系统日志                  ← 新增
  平台公告
  通知管理
  邮件投递
  安全事件
  审计日志
```

**节点状态页面功能：**
- 列表展示所有 offering：模型名、供应商、健康状态（closed/open/half-open/disabled）、连续失败次数、最后错误、cooldown 剩余
- 管理员操作：手动重置熔断、手动停用 offering（enabled=false）
- **管理员不能启用 offering** — 只有 offering owner 可以启用（避免管理员恢复一个有问题的节点）
- 自动停用的 offering 标记"已自动停用"，显示触发原因

### 四、失败请求写入 api_requests

**新增** `recordFailedRequest()` — 不做结算，只记录请求元数据 + 错误信息

```typescript
async recordFailedRequest(params: {
  requestId: string;
  requesterUserId: string;
  logicalModel: string;
  offeringId?: string;
  provider?: string;
  realModel?: string;
  errorMessage: string;
  clientIp?: string;
  clientUserAgent?: string;
}) → INSERT INTO api_requests (...) VALUES (..., status='error', response_body=errorJson)
```

**调用位置：**
- `chat.ts` catch 块
- `api-proxy.ts` catch 块

**管理员界面效果：** 请求明细列表出现 status=`error` 的记录，可点击查看错误详情。

### 五、管理员日志查看器

**后端：** `GET /v1/admin/logs`
- 读取 PM2 日志文件最近 N 行
- 参数：`limit`（默认 200）、`level`（info/warn/error）、`search`（关键词）
- 解析 JSON 格式日志行

**前端：** `AdminLogsPage.tsx`
- 侧边栏新增"系统日志"菜单
- 分级 tabs：全部 / INFO / WARN / ERROR
- 搜索框实时过滤
- 30 秒自动刷新
- ERROR 红色高亮、WARN 黄色高亮

---

## 改动文件清单

| 模块 | 文件 | 改动 |
|------|------|------|
| 熔断器 | `packages/core/src/resilience/circuit-breaker.ts` | 三级分类 + disabled 状态 + 递增 cooldown + 暴露状态查询 |
| Executor | `apps/platform-api/src/core/provider-executor.ts` | preferred hint + 错误分类调用 recordFailure |
| Router | `apps/platform-api/src/core/router.ts` | 返回 candidates + filterAvailable 修复 + 健康度权重 |
| Chat | `apps/platform-api/src/routes/chat.ts` | 传入 candidates + catch 写 recordFailedRequest |
| API Proxy | `apps/platform-api/src/routes/api-proxy.ts` | catch 写 recordFailedRequest |
| Repository | `apps/platform-api/src/repositories/postgres-platform-repository.ts` | recordFailedRequest |
| Interface | `apps/platform-api/src/repositories/platform-repository.ts` | 接口 |
| Admin API | `apps/platform-api/src/routes/admin.ts` | offering-health 端点 + logs 端点 |
| Admin UI | `apps/web/src/pages/admin/AdminLogsPage.tsx` | 新建日志页面 |
| Admin UI | `apps/web/src/components/layout/AdminLayout.tsx` | 侧边栏加菜单 |
| i18n | `apps/web/src/lib/i18n.ts` | 翻译 |
| Route | `apps/web/src/App.tsx` | 路由 |

## 实施顺序

| Step | 内容 | 优先级 |
|------|------|--------|
| 1 | 熔断器三级分类 + disabled + 递增 cooldown | P0 |
| 2 | 统一 executor fallback（router 返回 candidates, chat 传入全部）| P0 |
| 3 | 失败请求写入 api_requests | P0 |
| 4 | filterAvailable 修复 + 健康度权重 | P1 |
| 5 | 管理员 offering-health API + 手动重置/禁用 | P1 |
| 6 | 管理员日志查看器 | P2 |

## 验证

1. 模拟 1 个 offering 403 配额用完 → 自动 fallback 到另一个 → 降级 offering 递增 cooldown
2. 模拟 401 key 失效 → 立即 disabled → 只有管理员手动重置后恢复
3. 模拟全部 offerings 不可用 → 返回明确错误，不无限重试
4. 失败请求出现在管理员请求明细中（status=error）
5. 管理员可查看 offering 健康状态，手动重置/禁用
6. 管理员可查看/筛选系统日志
7. 所有单元测试 + E2E 通过
