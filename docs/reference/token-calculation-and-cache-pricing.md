# Token 计算与缓存定价 — 技术分析报告

## 概述

xllmapi 作为多供应商 API 代理，需要统一处理 OpenAI 和 Anthropic 两种不同的 token 计量体系。两者在缓存 token 的表示方式上有本质区别，xllmapi 需要将两种格式归一化为统一的内部表示，用于计费、统计和展示。

---

## 一、xllmapi 内部统一模型

xllmapi 将每次请求的 token 消耗拆分为 **四个独立不重叠** 的字段：

```
┌─────────────────────────────────────────────────────┐
│  inputTokens         非缓存的 input tokens           │
│                      (需要上游模型重新计算的部分)      │
├─────────────────────────────────────────────────────┤
│  cacheReadTokens     缓存命中的 input tokens          │
│                      (上游从缓存读取，不需重新计算)    │
├─────────────────────────────────────────────────────┤
│  cacheCreationTokens 缓存创建的 input tokens          │
│                      (首次写入缓存，上游有额外开销)    │
├─────────────────────────────────────────────────────┤
│  outputTokens        模型生成的输出 tokens             │
└─────────────────────────────────────────────────────┘

totalTokens = inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens
```

**数据库存储** (`api_requests` 表)：
- `input_tokens` — 非缓存 input
- `cache_read_tokens` — 缓存命中
- `cache_creation_tokens` — 缓存创建
- `output_tokens` — 输出
- `total_tokens` — 四者之和

---

## 二、OpenAI API 的 Token 格式

### 响应结构

```json
{
  "usage": {
    "prompt_tokens": 2006,
    "completion_tokens": 300,
    "total_tokens": 2306,
    "prompt_tokens_details": {
      "cached_tokens": 1920
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0
    }
  }
}
```

### 关键特征：`cached_tokens` 是 `prompt_tokens` 的子集

```
prompt_tokens = 2006  (全部 input，包含缓存部分)
    ├── cached_tokens = 1920  (缓存命中部分)
    └── 非缓存部分 = 2006 - 1920 = 86

completion_tokens = 300
total_tokens = prompt_tokens + completion_tokens = 2306
```

### xllmapi 提取逻辑

```typescript
// apps/platform-api/src/core/adapters/openai.ts
const cacheRead = prompt_tokens_details?.cached_tokens ?? 0;
const rawInput = prompt_tokens;                    // 包含 cached
const inputTokens = rawInput - cacheRead;          // 减去得到非缓存部分
const cacheCreationTokens = 0;                     // OpenAI 无此概念
```

### OpenAI 缓存机制

- **自动缓存**: 无需客户端标记，1024+ tokens 的 prompt 自动缓存
- **无 cache_creation**: 首次计算不额外收费，缓存写入是透明的
- **定价**: 缓存命中 50% 折扣 (prompt_tokens 全价的一半)
- **TTL**: 约 5-10 分钟不活动后过期

---

## 三、Anthropic API 的 Token 格式

### 响应结构

```json
{
  "usage": {
    "input_tokens": 50,
    "cache_read_input_tokens": 10000,
    "cache_creation_input_tokens": 248,
    "output_tokens": 503
  }
}
```

### 关键特征：三个 input 字段互不重叠

```
input_tokens = 50                    (非缓存部分，cache breakpoint 之后的内容)
cache_read_input_tokens = 10000      (缓存命中，与 input_tokens 并列)
cache_creation_input_tokens = 248    (缓存创建，与上面两者并列)

总 input = 50 + 10000 + 248 = 10298
Anthropic 不返回 total_tokens 字段
```

### xllmapi 提取逻辑

```typescript
// apps/platform-api/src/core/adapters/anthropic.ts
const inputTokens = input_tokens;                // 直接取，已是非缓存部分
const cacheRead = cache_read_input_tokens;       // 直接取
const cacheCreation = cache_creation_input_tokens; // 直接取
```

### Anthropic 缓存机制

- **显式标记**: 需要在请求中添加 `cache_control: {type: "ephemeral"}` 标记
- **有 cache_creation**: 首次写入缓存额外收费 (1.25× 或 2×)
- **TTL 可选**: 5 分钟 (默认, 1.25× 写入价) 或 1 小时 (2× 写入价)
- **最多 4 个 breakpoint**: 可以分段缓存 (tools、system、context、conversation)
- **最低 token 要求**: Claude Opus 需 4096+，Sonnet 需 1024+ tokens 才触发缓存

---

## 四、两种格式的核心区别

| 维度 | OpenAI | Anthropic |
|------|--------|-----------|
| cached 与 input 关系 | `cached ⊂ prompt_tokens` (子集) | `cache_read ∥ input_tokens` (并列) |
| `prompt_tokens` / `input_tokens` 含义 | **包含**缓存部分 | **不含**缓存部分 |
| 提取非缓存 input | `prompt_tokens - cached_tokens` | 直接取 `input_tokens` |
| `total_tokens` 字段 | 有 (`prompt + completion`) | 无 (需自行计算) |
| cache creation | 无此概念 (自动, 不额外收费) | 有 (1.25× 或 2× 写入价) |
| 缓存触发方式 | 自动 (1024+ tokens) | 显式 (`cache_control` 标记) |
| 缓存命中折扣 | 50% | 90% |

---

## 五、缓存生命周期详解

### 请求 1 — 首次发送 (缓存写入)

```
客户端发送: [100K system prompt] + [50 token 用户消息]

Anthropic 处理:
  100K system prompt → 写入缓存 → cache_creation_input_tokens = 100,000
  50 token 消息     → 不缓存     → input_tokens = 50

响应:
  cache_creation_input_tokens: 100,000  (首次写入)
  cache_read_input_tokens: 0            (无缓存可读)
  input_tokens: 50                      (非缓存)
  output_tokens: 200
```

### 请求 2 — 5 分钟内重复 (缓存命中)

```
客户端发送: [100K system prompt] + [80 token 新消息]

Anthropic 处理:
  100K system prompt → 缓存命中! → cache_read_input_tokens = 100,000
  80 token 消息     → 不缓存      → input_tokens = 80

响应:
  cache_creation_input_tokens: 0        (无新写入)
  cache_read_input_tokens: 100,000      (全部命中!)
  input_tokens: 80                      (非缓存)
  output_tokens: 150
```

### 请求 3 — 超过 5 分钟 (缓存过期)

```
客户端发送: [100K system prompt] + [60 token 新消息]

Anthropic 处理:
  100K system prompt → 缓存过期，重新写入 → cache_creation_input_tokens = 100,000
  60 token 消息     → 不缓存               → input_tokens = 60

响应:
  cache_creation_input_tokens: 100,000  (重新写入)
  cache_read_input_tokens: 0            (缓存已过期)
  input_tokens: 60                      (非缓存)
  output_tokens: 180
```

---

## 六、定价对比

### Anthropic 定价 (以 Claude Opus 为例, $5/MTok 基准)

| Token 类型 | 价格 | 倍率 | 场景 |
|-----------|------|------|------|
| input_tokens | $5/MTok | 1.0× | 常规处理 |
| cache_creation (5min) | $6.25/MTok | 1.25× | 首次写入缓存 |
| cache_creation (1hour) | $10/MTok | 2.0× | 长 TTL 写入 |
| cache_read | $0.50/MTok | 0.1× | 缓存命中 |
| output_tokens | $25/MTok | 5.0× | 模型输出 |

### OpenAI 定价

| Token 类型 | 价格 | 倍率 | 场景 |
|-----------|------|------|------|
| prompt_tokens (非缓存部分) | 全价 | 1.0× | 常规处理 |
| cached_tokens | 半价 | 0.5× | 缓存命中 |
| completion_tokens | 全价 | 1.0× (output 价) | 模型输出 |

### 费用实例

100K tokens 的 system prompt 在 Anthropic (Claude Opus):

```
首次请求 (写入缓存):
  cache_creation: 100,000 × $5 × 1.25 / 1M = $0.625
  input_tokens:   50 × $5 / 1M              = $0.00025
  总 input 费用: $0.625

后续请求 (缓存命中):
  cache_read:     100,000 × $5 × 0.1 / 1M   = $0.05   (省 92%)
  input_tokens:   80 × $5 / 1M              = $0.0004
  总 input 费用: $0.05
```

---

## 七、xllmapi 差异化计费

### offerings 配置

每个 offering (模型节点) 配置:
- `fixed_price_per_1k_input` — input 单价 (xtokens / 1K tokens)
- `fixed_price_per_1k_output` — output 单价
- `cache_read_discount` — 缓存命中折扣率 (1-100%, 默认 50%)

### 计费公式

```
freshInputCost     = CEIL(inputTokens × fixedPricePer1kInput / 1000)
cacheReadCost      = CEIL(cacheReadTokens × fixedPricePer1kInput × cacheReadDiscount% / 1000)
cacheCreationCost  = CEIL(cacheCreationTokens × fixedPricePer1kInput / 1000)
outputCost         = CEIL(outputTokens × fixedPricePer1kOutput / 1000)

consumerCost = freshInputCost + cacheReadCost + cacheCreationCost + outputCost
```

### 计算示例

```
请求: 100 inputTokens + 800 cacheRead + 50 cacheCreation + 50 outputTokens
定价: input 1000 xt/1K, output 2000 xt/1K, cache discount 30%

freshInputCost    = CEIL(100 × 1000 / 1000)            = 100 xt
cacheReadCost     = CEIL(800 × 1000 × 30% / 1000)      = 240 xt  (全价 800 xt)
cacheCreationCost = CEIL(50 × 1000 / 1000)              = 50 xt
outputCost        = CEIL(50 × 2000 / 1000)              = 100 xt

consumerCost = 100 + 240 + 50 + 100 = 490 xt
(对比无折扣: 100 + 800 + 50 + 100 = 1050 xt, 节省 53%)
```

---

## 八、数据流总图

```
上游 API 响应
    │
    ├── OpenAI: {prompt_tokens: 900, cached_tokens: 800, completion_tokens: 50}
    │   └── 提取: input=100, cacheRead=800, cacheCreation=0, output=50
    │
    └── Anthropic: {input_tokens: 100, cache_read: 800, cache_creation: 0, output: 50}
        └── 提取: input=100, cacheRead=800, cacheCreation=0, output=50
    │
    ▼ 统一 ProxyUsage
    │
    { inputTokens: 100, cacheReadTokens: 800, cacheCreationTokens: 0, outputTokens: 50 }
    │
    ├── totalTokens = 100 + 800 + 0 + 50 = 950
    │
    ├──→ api_requests 表 (存储 5 个字段)
    │
    └──→ settlement 计费 (差异化价格)
         freshInput: 100 × price
         cacheRead:  800 × price × discount%
         cacheCreation: 0
         output: 50 × outputPrice
```

---

## 九、涉及的代码文件

| 文件 | 职责 |
|------|------|
| `apps/platform-api/src/core/adapters/types.ts` | ProxyUsage 接口定义 |
| `apps/platform-api/src/core/adapters/openai.ts` | OpenAI 格式提取 (prompt_tokens - cached) |
| `apps/platform-api/src/core/adapters/anthropic.ts` | Anthropic 格式提取 (三字段并列) |
| `apps/platform-api/src/core/provider-executor.ts` | 透传路径 usage 提取 + early capture |
| `packages/core/src/providers/openai.ts` | Chat 路径 OpenAI streaming 提取 |
| `packages/core/src/providers/anthropic.ts` | Chat 路径 Anthropic streaming 提取 |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | Settlement 差异化计费 |
| `infra/sql/postgres/023_cache_tokens.sql` | 数据库迁移 |
