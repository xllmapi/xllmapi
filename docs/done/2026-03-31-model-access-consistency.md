# 用户模型访问策略分析报告

## 一、当前策略总结

### 1.1 模型列表获取

```
用户打开 Chat 页面
├── 调用 GET /v1/me/connection-pool 获取用户连接池
│   ├── 有 offerings → 使用连接池中的模型（过滤 paused=true）
│   └── 连接池为空 → fallback 到 GET /v1/network/models（所有平台模型）
└── 显示模型选择器
```

**新用户（未加入任何模型）**：连接池为空 → fallback 显示所有平台模型 → 可以直接使用。

**已加入模型的用户**：只显示连接池中的模型 → 如果想用新模型，需要去 marketplace 手动添加。

### 1.2 请求路由（resolveOfferings）

```
resolveOfferings(model, userId)
├── 用户有连接池？
│   ├── YES → findUserOfferingsForModel（只返回用户 favorites 中的 offerings）
│   │   └── 该模型无结果？ → fallback: findOfferingsForModel
│   │       └── 过滤: executionMode != "node" AND !thirdParty
│   └── NO → findOfferingsForModel
│       └── 过滤: executionMode != "node" AND !thirdParty
├── 应用价格过滤（用户自定义的 maxInputPrice/maxOutputPrice）
└── 返回候选 offerings
```

### 1.3 请求优先级（routeRequest → selectOffering）

| 优先级 | 策略 | 条件 | TTL |
|--------|------|------|-----|
| 1 | 会话亲和性 | 同一 conversationId 复用上次 offering | 30 分钟 |
| 2 | 用户亲和性 | 该用户最近用过的 offering（最多 3 个） | 2 小时 |
| 3 | 负载均衡 | `estimatedWaitMs + avgLatencyMs` 排序，取 top 3 随机 | 实时 |
| 4 | 随机 fallback | 超时后换一个 | - |

**亲和性阈值**：会话消息数越多，容忍的等待时间越长（2s → 3s → 4s），因为长对话切换 offering 的成本更高。

## 二、两种使用视角

### Chat 视角（Web 页面）
- 模型列表由 `useUserModels` 决定 → 影响用户**能看到**什么
- 请求走 `POST /v1/chat/conversations/:id/messages` → `routes/chat.ts`
- 模型选择 **受前端模型列表限制** — 列表里没有的模型无法选择

### API 视角（opencode / Claude Code / SDK）
- 客户端自己指定模型名（如 `deepseek-chat`）
- 请求走 `POST /v1/chat/completions` 或 `POST /v1/messages` → `routes/api-proxy.ts`
- 不受前端模型列表限制 — 只要 `resolveOfferings` 能找到就行
- **API 用户可以用所有官方平台模型**（即使没加入连接池），因为 resolveOfferings 的 fallback

### 关键差异

| 维度 | Chat 页面 | API 调用 |
|------|----------|---------|
| 模型可见性 | 受 `useUserModels` 限制 | `GET /v1/models` 返回所有平台模型（含第三方） |
| 模型可用性 | 同上 | 由 `resolveOfferings` 决定 |
| 有连接池时 | 只显示连接池的模型 | 连接池优先，fallback 到非第三方平台模型 |
| 第三方模型 | 需加入连接池后显示 | 需加入连接池才能路由 |

### API 模型列表 vs 实际可用性**不一致**

| API | 返回内容 | thirdParty 过滤 |
|-----|---------|----------------|
| `GET /v1/models` | 所有平台模型（含第三方） | ❌ 不过滤 |
| `resolveOfferings` fallback | 非第三方平台模型 | ✅ 过滤 |

**后果**：API 用户看到第三方模型在列表中，实际请求 → 404。需要 `/v1/models` 也过滤或标记。

### 当前模型命名方案

实际数据：

| logicalModel (用户面对) | realModel (发给上游) | 供应商 | thirdParty |
|------------------------|--------------------|----|------------|
| deepseek-chat | deepseek-chat | DeepSeek | false |
| mimo-v2-omni | mimo-v2-omni | MiMo | false |
| gpt-5.4 | gpt-5.4 | OpenAI-AH | true |
| gpt-5.4 | gpt-5.4-ah | OpenAI-AH | true |

**当前方案**：第三方的 `logicalModel` 与官方模型名相同（如 `gpt-5.4`），不加后缀区分。但 preset 的 models JSON 中定义了 `-ah` 后缀的 logicalModel（如 `gpt-5.4-ah`），实际创建 offering 时用户可能没用后缀。

**分析**：
- **方案 A — logicalModel 加后缀**（如 `gpt-5.4-ah`）：
  - 优点：用户/API 一眼能分辨官方 vs 第三方
  - 优点：`/v1/models` 列表中不会混淆
  - 缺点：API 用户需要知道后缀名，兼容性差

- **方案 B — logicalModel 保持一致**（如 `gpt-5.4`）：
  - 优点：API 兼容，opencode 等工具无需改配置
  - 优点：第三方和官方的模型可以互为 fallback
  - 缺点：用户无法从模型名区分来源，需靠 UI 标签

- **推荐方案 B + UI 标签**：logicalModel 保持一致，在 Chat/marketplace 的 UI 上用标签/颜色区分。`/v1/models` API 中增加 `thirdParty` 标记字段。

## 三、问题分析

### 问题 1：连接池的"陷阱效应"

**场景**：用户加入了 deepseek-chat → 连接池有 1 个条目 → 系统不再 fallback 到全部平台模型 → 用户在 Chat 只能看到 deepseek-chat。

如果用户想用 MiniMax-M2.7，必须去 marketplace 手动添加。**但用户可能不知道要去添加**。

**影响**：用户体验断崖 — 加入第一个模型后，反而比不加入时可用的模型少。

### 问题 2：官方直连模型需要手动添加

当前所有平台节点（包括 DeepSeek、Kimi 等官方直连）对**有连接池的用户**不自动可用。这不合理 — 官方直连的模型应该始终可用。

### 问题 3：路由缺少价格和缓存命中考量

当前 `selectOffering` 完全基于**负载/延迟**选择：

**缺失 1 — 价格**：同一模型多个 offerings（不同供应商/价格），用户可能被路由到贵的，而便宜的 offering 空闲。

**缺失 2 — 缓存命中**：很多模型提供商（MiMo、DeepSeek 等）支持 prompt caching。用同一个 offering 的好处：
- 上游 `cached_tokens` 越高，实际消耗越少
- 供应商成本更低，平台抽成不变
- 对话体验更连贯

当前亲和性机制（会话 30min + 用户 2h）部分缓解了这个问题，但**负载均衡阶段不考虑价格和缓存收益**。

### 问题 4：第三方模型对新用户不可见（已解决）

`!thirdParty` 过滤已正确排除第三方模型的自动可用。

## 三、优化建议

### 建议 1（P0）：官方直连模型自动可用

**目标**：`thirdParty=false` 且 `executionMode=platform` 的官方模型，即使用户已有连接池，也应作为 fallback 可用。

**修改 resolveOfferings**：
```
用户有连接池？
├── YES → findUserOfferingsForModel
│   └── 该模型无结果？
│       → fallback: findOfferingsForModel（只返回非 thirdParty 的平台 offerings）  ← 现有
│       → ✅ 已正确处理
```

实际上现有逻辑已经处理了这个场景 — 如果用户连接池里没有该模型，会 fallback 到平台 offerings。**问题不在路由，而在前端模型列表**。

前端 `useUserModels` 的逻辑是：有连接池 → **只显示连接池中的模型**。用户看不到其他平台模型，但如果通过 API 直接请求（如 opencode），仍然可以用。

**修复方案**：前端模型列表合并连接池 + 官方平台模型：
```
userModels = 连接池中的模型（用户主动添加的）
           + 所有官方平台模型（thirdParty=false）去重
```

这样用户在 Chat 页面始终能看到所有官方模型，同时自己添加的第三方模型也在列表中。

### 建议 2（P1）：官方直连模型作为默认行为

**核心思路**：官方直连模型（`thirdParty=false`, `executionMode=platform`）是"默认模型"，始终可用，不需要用户操作，也不出现在用户连接列表中。

**前端 useUserModels 改造**：
```
1. 始终获取 /v1/network/models → 过滤 thirdParty=false → 作为"默认模型"
2. 获取 /v1/me/connection-pool → 作为"额外添加的模型"
3. 合并去重 → Chat 模型列表
```

**UsingTab（连接的模型）**：
- 只显示用户主动添加的模型（第三方 / 分布式节点）
- 不显示默认官方模型（它们始终可用，无需管理）

**Chat 模型选择器**：
- 显示：默认官方模型 + 用户额外添加的
- 默认模型可用小标签区分（如 "默认" tag）

**API 行为不变**：resolveOfferings 已正确 fallback 到官方平台模型。

### 建议 3（P2）：路由支持价格 + 缓存偏好

**价格感知**：在 load-based 阶段增加综合评分：
```
score = estimatedTotalMs * (1 + priceFactor)
priceFactor = (offeringPrice - minPrice) / minPrice * 0.3
```
便宜的 offering 评分更低（更优先），但不完全压过延迟 — 避免所有请求涌向最便宜的。

**缓存亲和增强**：延长亲和性 TTL 以最大化 prompt cache hit：
- 会话亲和 30min → 60min（长对话的缓存收益更大）
- 用户亲和 2h → 4h（同一用户倾向同一 offering，提高 cached_tokens 率）

已有 `maxInputPrice/maxOutputPrice` 硬过滤保持不变，价格感知只作为软偏好。

### 建议 4（P2）：新用户引导

新用户首次进入 Chat 时，如果未加入任何模型：
- 默认自动加入 1-2 个推荐模型到连接池
- 或在 Chat 页面显示"推荐模型"快速添加按钮

## 四、请求优先级策略评价

| 方面 | 评价 |
|------|------|
| 会话亲和性 | ✅ 优秀 — 同一对话保持同一 offering，避免上下文切换 |
| 用户亲和性 | ✅ 好 — 用户倾向性自动学习，无需手动配置 |
| 负载均衡 | ✅ 好 — 基于实际队列等待+延迟，实时感知 |
| 断路器 | ✅ 好 — 自动隔离故障 offering |
| 价格感知 | ❌ 缺失 — 同模型多供应商时无价格偏好，可能路由到贵的 |
| 缓存收益 | ⚠️ 隐式 — 亲和性间接提高 cache hit，但 TTL 偏短且负载均衡阶段不考虑 |
| 质量感知 | ⚠️ 隐式 — 断路器处理故障，但不主动偏好高成功率 offering |
| Chat vs API 一致性 | ❌ 不一致 — Chat 模型列表比 API 实际可用的少 |
