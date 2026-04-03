# 缓存 Token 支持 — 差异化计费

## 背景

OpenAI/Anthropic 的 Prompt Caching 机制允许上游对重复输入进行缓存，缓存命中的 tokens 价格显著低于全价。xllmapi 之前将缓存字段合并进 inputTokens，丢失粒度，无法差异化计费，用户也看不到缓存带来的节省。

### 上游格式差异

| 维度 | OpenAI | Anthropic |
|------|--------|-----------|
| cached 与 input 关系 | `cached ⊂ prompt_tokens` (子集) | `cache_read ∥ input_tokens` (并列) |
| 提取非缓存 input | `prompt_tokens - cached_tokens` | 直接取 `input_tokens` |
| cache creation | 无此概念 (自动缓存) | 有 (1.25× 或 2× 写入价) |
| 缓存命中折扣 | 50% | 90% |

详细技术参考: `docs/reference/token-calculation-and-cache-pricing.md`

---

## 架构设计: 统一 Usage 解析层

### 核心问题

Token 解析分散在 6 个独立提取点，每个都有自己的逻辑 — 任何一个理解错了就产生计费 bug。

### 解决方案: 三层架构

```
Layer 0: parseRawUsage(raw, format?)    — 唯一解析函数 (core package)
Layer 1: Format Adapter                 — 从响应中定位 usage 对象
Layer 2: Provider Hooks (可选)          — 特定供应商覆盖解析行为
```

**parseRawUsage** 是纯函数，只负责 `raw usage object → ProxyUsage`，内部区分 OpenAI/Anthropic 格式。所有 6 个提取点统一调用它。

**mergeUsage** 用于跨事件合并（如 Anthropic 的 message_start + message_delta），取每个字段的最大值。

**ProviderHooks 扩展**:
- `parseUsage?` — 覆盖解析逻辑 (如 Kimi 特殊格式)
- `adjustUsage?` — 多事件合并后处理

---

## 实现内容

### 数据库迁移 (023_cache_tokens.sql)

```sql
ALTER TABLE api_requests ADD COLUMN cache_read_tokens INTEGER DEFAULT 0;
ALTER TABLE api_requests ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0;
ALTER TABLE offerings ADD COLUMN cache_read_discount INTEGER DEFAULT 50;
```

### 后端改动 (14 文件)

| 文件 | 改动 |
|------|------|
| `packages/core/src/usage-parser.ts` | **新建**: parseRawUsage + mergeUsage (核心解析) |
| `adapters/usage-parser.ts` | Re-export from core |
| `adapters/types.ts` | ProxyUsage +2 fields, ProviderHooks +parseUsage/adjustUsage |
| `adapters/openai.ts` | 改用 parseRawUsage("openai") |
| `adapters/anthropic.ts` | 改用 parseRawUsage("anthropic") + mergeUsage |
| `adapters/providers/mimo.ts` | 简化，base adapter 的 mergeUsage 已处理 MiMo |
| `adapters/response-converter.ts` | JSON+流式转换透传 cache 字段 |
| `core/providers/openai.ts` | 改用 parseRawUsage |
| `core/providers/anthropic.ts` | 改用 parseRawUsage + mergeUsage |
| `provider-executor.ts` | earlyCapture 用 parseRawUsage + mergeUsage |
| `postgres-platform-repository.ts` | Settlement 差异化计费 + 存储 + 查询聚合 cache |
| `routes/provider.ts` | offering 创建/更新支持 cacheReadDiscount |
| `services/ledger-service.ts` | ledger 查询 JOIN offerings 返回 cache 数据 |
| `shared-types/offerings.ts` | CandidateOffering + cacheReadDiscount |

### 计费公式

```
freshInputCost     = CEIL(inputTokens × price / 1000)
cacheReadCost      = CEIL(cacheReadTokens × price × discount% / 1000)
cacheCreationCost  = CEIL(cacheCreationTokens × price / 1000)
outputCost         = CEIL(outputTokens × outputPrice / 1000)
consumerCost       = freshInputCost + cacheReadCost + cacheCreationCost + outputCost
```

`cache_read_discount`: 1-100%，默认 50%

### 前端改动 (6 页面)

| 页面 | 改动 |
|------|------|
| **Admin 请求详情** | Token 区: cache read/creation 行; 结算区: 原价→缓存节省→实付 |
| **Admin 结算记录** | 消费列 `1488(-883)` 格式 + 实付列 + Cache Hit Tokens 汇总 |
| **用户明细** | xtokens 列绿色 `省883` (hover 提示) |
| **模型卡片 + 详情** | 绿色 `cache 40%` 标签 (模型级平均折扣) |
| **节点管理** | 供给卡片显示 `cache 40%`; 连接模型展开显示缓存折扣 |
| **节点配置弹窗** | 缓存折扣输入框 (1-100%) |

---

## 测试方案

### 测试文件

| 文件 | 测试数 | 覆盖范围 |
|------|--------|---------|
| `usage-parser.test.ts` | 20 | 统一解析器核心逻辑 |
| `cache-tokens.test.ts` | 31 | 端到端 6 层覆盖 |
| **合计** | **51** | |

### 6 层测试覆盖

**Layer 1: 统一解析器 (parseRawUsage)**

| 场景 | 输入 | 预期 |
|------|------|------|
| OpenAI 有缓存 | `prompt=1200, cached=1024` | `input=176, cacheRead=1024, total=1210` |
| OpenAI 无缓存 | `prompt=500, completion=100` | `input=500, cacheRead=0, total=600` |
| OpenAI cached=0 | `prompt=300, cached=0` | `input=300, cacheRead=0` |
| Anthropic 有缓存+创建 | `input=50, read=10000, create=248` | 各字段分离, `total=10801` |
| Anthropic 无缓存 | `input=200, output=30` | `cacheRead=0, total=230` |
| Kimi 特殊 | `input=0, read=13` | `input=0, cacheRead=13` (不双倍计费) |
| DeepSeek 格式 | `prompt=2974, cached=2944` | `input=30, cacheRead=2944` |
| 负数防御 | `prompt=5, cached=10` | `input=0` (clamp) |
| totalTokens 重算 | `total=99999` | 忽略上游值，自行计算 |
| 格式自动检测 | 5 种组合 | cache_read→anthropic, prompt_details→openai |

**Layer 2: 适配器提取**

| 场景 | 输入 | 预期 |
|------|------|------|
| OpenAI stream+cache | SSE tail 含 cached_tokens | 正确拆分 5 字段 |
| OpenAI stream 无 cache | 标准 SSE | cacheRead=0 |
| OpenAI JSON+cache | JSON body 含 prompt_tokens_details | 正确拆分 |
| Anthropic stream+cache | message_start 含 cache_read | 正确拆分 |
| Anthropic JSON+cache | 含 cache_read + cache_creation | 3 个 cache 字段正确 |
| MiMo multi-event | message_start=0, delta=42+800 | mergeUsage 取 max |

**Layer 3: Settlement 计费**

| 场景 | 输入 | 预期 |
|------|------|------|
| 40% 折扣 | `in=30, cache=2944, price=500` | `cost=605` (vs 全价1488) |
| 100% 折扣 | `discount=100` | 等于无折扣 |
| 1% 最低折扣 | `cache=10000, discount=1` | `cacheCost=100` |
| cacheCreation 全价 | `creation=1000` | 按 input price 全价 |

**Layer 4: 非流式 JSON 转换**

| 场景 | 输入 | 预期 |
|------|------|------|
| OpenAI→Anthropic | usage 含 prompt_tokens_details | Anthropic usage 含 cache_read |
| Anthropic→OpenAI | usage 含 cache_read | prompt_tokens 包含 cached, prompt_tokens_details 保留 |
| 无 cache 转换 | 标准 usage | 无多余 cache 字段 |

**Layer 5: 流式转换**

| 场景 | 输入 | 预期 |
|------|------|------|
| OpenAI→Anthropic 有 cache | usage chunk 含 cached | message_delta 含 cache_read_input_tokens |
| OpenAI→Anthropic 无 cache | 标准 usage | message_delta 无 cache 字段 |
| Anthropic→OpenAI | cache events | 正确转为 OpenAI 格式 |
| Auto-detect + cache | 自动检测后转换 | cache 字段保留 |

**Layer 6: mergeUsage**

| 场景 | 输入 | 预期 |
|------|------|------|
| 正常 merge | start+delta | 取各字段 max, 重算 total |
| 一侧为零 | usage+ZERO | 返回非零侧 |
| 两侧为零 | ZERO+ZERO | ZERO_USAGE |

### 真实 API 验证 (本地手动)

| 测试 | 结果 |
|------|------|
| DeepSeek Request 1 (无缓存) | `in=2974, cache=0, cost=1488 xt` ✅ |
| DeepSeek Request 2 (缓存命中) | `in=30, cache=2944, cost=605 xt` ✅ |
| DeepSeek Request 3 (流式+缓存) | `in=30, cache=2944, cost=605 xt` ✅ |
| Settlement 节省 | `1488-605=883 xt (59%)` ✅ |

---

## 状态: ✅ 已完成

- 140/140 单元测试通过
- Build 通过
- 真实 DeepSeek API 缓存验证通过
- 前端 6 个页面 UI 验收通过
