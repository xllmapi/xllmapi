# xllmapi Token 统计方式深度分析报告

## 一、平台当前 Token 统计实现

### 1.1 核心机制：依赖上游 API 返回的 usage 字段

平台**不使用本地 tokenizer**（无 tiktoken、sentencepiece 等依赖），而是从上游模型提供商的 API 响应中提取 token 用量。

**数据流：**
```
用户请求 → 平台代理 → 上游 API → 响应包含 usage 字段
                                          ↓
                               adapter.extractUsage()
                                          ↓
                               recordChatSettlement()
                                          ↓
                            api_requests 表 + 钱包扣费
```

### 1.2 提取方式（两个 adapter）

**OpenAI adapter** (`apps/platform-api/src/core/adapters/openai.ts`):
- 流式：从尾部 4KB buffer 反向搜索包含 `"usage"` 的 `data:` 行
- 非流式：直接从 JSON response body 的 `usage` 字段提取
- 字段映射：`prompt_tokens` → inputTokens, `completion_tokens` → outputTokens
- 支持缓存 token：`cache_read_input_tokens + cache_creation_input_tokens`

**Anthropic adapter** (`apps/platform-api/src/core/adapters/anthropic.ts`):
- 流式：正向遍历 SSE，从 `message_start` 提取 input_tokens，从 `message_delta` 提取 output_tokens
- 非流式：直接从 `usage` 字段提取
- 同样支持缓存 token

### 1.3 Fallback 估算逻辑（两处）

当上游 API 不返回 usage 时，存在两处估算：

| 位置 | 公式 | 用途 |
|------|------|------|
| `packages/core/src/providers/openai.ts:113` | `outputTokens = Math.ceil(content.length / 4)` | 流式响应无 usage 时估算 output |
| `packages/core/src/context/context-manager.ts:19` | `estimateTokens = Math.ceil(text.length / 3.5)` | 上下文窗口裁剪预估 |

### 1.4 结算计费

`postgres-platform-repository.ts:2355-2429` 的 `recordChatSettlement`:
```
inputCost  = ceil(inputTokens × fixedPricePer1kInput / 1000)
outputCost = ceil(outputTokens × fixedPricePer1kOutput / 1000)
consumerCost = inputCost + outputCost  (扣消费者钱包)
supplierReward = floor(consumerCost × 0.85)  (入供应商钱包)
platformMargin = consumerCost - supplierReward  (平台抽成)
```

### 1.5 Usage 缺失时的处理

`provider-executor.ts:308`: 初始化为 `{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }`
- 如果 adapter 提取失败 → usage 全为 0 → **不计费**（免费请求）
- 这意味着如果上游不返回 usage，平台不会向用户收费

---

## 二、业界 Token 统计方式调研

### 2.1 OpenAI

| 项目 | 详情 |
|------|------|
| **Tokenizer** | tiktoken（开源 BPE 编码器） |
| **编码** | cl100k_base (GPT-4/3.5)、o200k_base (GPT-4o，对非英文更高效) |
| **英文** | ~4 字符/token，~0.75 词/token |
| **中文** | cl100k_base: 1-2 token/字；o200k_base: 更高效 |
| **计费依据** | API 响应 `usage.prompt_tokens` / `usage.completion_tokens`（服务端精确计算） |
| **客户端预估** | `pip install tiktoken` 可本地精确计算（与服务端一致） |

### 2.2 Anthropic/Claude

| 项目 | 详情 |
|------|------|
| **Tokenizer** | 私有，不公开 |
| **计费依据** | API 响应 `usage.input_tokens` / `usage.output_tokens` |
| **客户端预估** | 提供免费 `messages.count_tokens` API 端点（估算，可能有小幅偏差） |
| **特殊** | 流式通过 `message_start` 和 `message_delta` SSE 事件分别返回 input/output tokens |

### 2.3 DeepSeek

| 项目 | 详情 |
|------|------|
| **Tokenizer** | 私有，提供离线工具下载 |
| **英文** | ~3-4 字符/token |
| **中文** | ~0.6 token/字（比 OpenAI 高效） |
| **计费依据** | API 响应 usage 字段（兼容 OpenAI 格式） |

### 2.4 Google Gemini

| 项目 | 详情 |
|------|------|
| **Tokenizer** | 私有 |
| **估算** | ~4 字符/token，100 tokens ≈ 60-80 英文词 |
| **计费依据** | API 响应 `usage_metadata` |
| **客户端预估** | 提供免费 `count_tokens()` 方法 |

### 2.5 关键结论

**所有主流厂商的计费都基于服务端返回的 token 数**，不依赖客户端估算。客户端 tokenizer/API 仅用于预估（成本预测、上下文管理）。

---

## 三、平台合理性分析

### 3.1 合理之处

| 方面 | 评价 |
|------|------|
| **计费数据源** | ✅ 完全正确 — 使用上游 API 返回的 usage，这是业界标准做法 |
| **input/output 分别计价** | ✅ 与 OpenAI/Anthropic 计价模型一致 |
| **缓存 token 处理** | ✅ 支持 `cache_read + cache_creation` 归入 input |
| **多格式适配** | ✅ OpenAI/Anthropic 双格式提取，覆盖主流上游 |
| **流式提取** | ✅ 4KB tail buffer 策略合理，usage 通常在流末尾 |

### 3.2 存在的问题

#### 问题 1：Usage 缺失时「静默免费」（严重）

**现状**：当 adapter 提取不到 usage 时，token 全为 0，不计费。

**风险**：
- 某些提供商（小众或自部署模型）可能不返回 usage 字段
- 流式响应的 `stream_options.include_usage` 未被强制设置 — 如果上游不支持或未开启，流式请求可能无 usage
- 格式转换后上游返回非标准格式，JSON parse 失败时也会导致 usage 为 0

**影响**：用户可能零成本消耗大量上游 API 资源，供应商承担成本。

**建议**：
```
方案 A（推荐）：增加 fallback 估算 + 警告日志
  - 当 usage 全为 0 且响应成功时，用 estimateTokens 估算 output
  - 用请求体 messages 估算 input
  - 记录 settlement 时标记 estimated=true
  - 触发告警日志，供运营排查

方案 B：拒绝无 usage 的提供商
  - 在 offering 配置中增加 requireUsage 标记
  - 无 usage 的响应标记为 settlement_failed
```

#### 问题 2：`estimateTokens` 的 `length/3.5` 对中文严重不准确（中等）

**现状**：`packages/core/src/context/context-manager.ts:19`
```typescript
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
```

**问题**：
- 此公式假设 1 token ≈ 3.5 字符，适用于英文
- 中文每个字符 1-2 个 UTF-16 code unit，实际 1 中文字 ≈ 0.6-2 token（取决于 tokenizer）
- 一段 100 字的中文：`length=100`，估算=29 tokens，实际可能 60-200 tokens
- **严重低估中文 token 数**，导致上下文窗口裁剪不充分

**建议**：
```typescript
export function estimateTokens(text: string): number {
  // 粗略区分 CJK 和 ASCII 字符
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // CJK Unified Ideographs + extensions + common fullwidth
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFF00 && code <= 0xFFEF)) {
      tokens += 1.5; // 中文字平均 1-2 token
    } else {
      tokens += 0.3; // 英文字符平均 ~0.25-0.3 token
    }
  }
  return Math.ceil(tokens);
}
```

#### 问题 3：流式响应 Anthropic adapter 的 tail buffer 可能截断 `message_start`（低）

**现状**：Anthropic 流式中，`message_start`（含 input_tokens）在流的**开头**发送，而 tail buffer 只保留最后 4KB。

**风险**：如果整个流的响应超过 4KB（几乎所有正常请求），`message_start` 事件会被截断，导致 `inputTokens = 0`。

**代码**：`provider-executor.ts:330-331`
```typescript
tailBuf += str;
if (tailBuf.length > TAIL_SIZE * 2) tailBuf = tailBuf.slice(-TAIL_SIZE);
```

**但实际影响可能有限**：因为 Anthropic 的 `message_delta`（含 output_tokens）在流末尾，会被捕获。而平台代理层是直接对上游的原始 SSE 提取 usage，如果 output_tokens 有值，至少不会完全为 0。

**建议**：
```
方案：对 Anthropic 流，在流开始时额外捕获 message_start 的 input_tokens
  - 在 nodeStream.on("data") 中检测首个 message_start 事件
  - 单独记录 inputTokens，不依赖 tail buffer
```

#### 问题 4：`Math.ceil(content.length / 4)` fallback 对中文同样不准（低）

**现状**：`packages/core/src/providers/openai.ts:113`
```typescript
usage.outputTokens = Math.ceil(content.length / 4);
```

**影响较小**：此 fallback 仅在上游不返回 usage 时触发（packages/core 层，非 platform-api 主路径），但如果触发，中文 output 会被严重低估。

---

## 四、各提供商 Usage 兼容度评估

### 4.1 平台当前支持的提供商

| 提供商 | 类型 | adapter | 流式 usage 机制 |
|--------|------|---------|----------------|
| DeepSeek | `openai_compatible` | openai | `stream_options.include_usage` |
| MiniMax | `openai_compatible` | openai | `stream_options.include_usage` |
| Kimi/Moonshot | `openai_compatible` | openai | `stream_options.include_usage` |
| Kimi Coding | `openai_compatible` | openai | `stream_options.include_usage` |
| OpenAI | `openai` | openai | `stream_options.include_usage` |
| Anthropic | `anthropic` | anthropic | SSE events (message_start/delta) |
| MiMo | `openai_compatible` | openai | `stream_options.include_usage` |

### 4.2 兼容度做得好的地方

**1. `stream_options.include_usage: true` 已正确设置** ✅
- `packages/core/src/providers/openai.ts:37` 对所有 OpenAI 格式请求都设置了此选项
- 这是获取 OpenAI 流式 usage 的**必要条件**，没有它流式请求不返回 usage
- DeepSeek、Kimi、MiniMax 等兼容 OpenAI 的提供商都受益

**2. 双格式 adapter 覆盖主流** ✅
- OpenAI adapter：覆盖所有 `openai` 和 `openai_compatible` 类型
- Anthropic adapter：覆盖 Anthropic 原生格式
- 字段名兼容：同时支持 `prompt_tokens/input_tokens`、`completion_tokens/output_tokens` 多种命名

**3. 缓存 token 正确归入 input** ✅
- `cache_read_input_tokens + cache_creation_input_tokens` 被正确累加
- 这对 OpenAI 和 Anthropic 的 prompt caching 功能很重要

**4. 非流式 JSON 响应 usage 保留完整** ✅
- 格式转换时 usage 字段名正确映射（prompt_tokens ↔ input_tokens）
- `totalTokens` 在需要时自动计算

**5. packages/core 层有 fallback 估算** ✅
- 当 OpenAI 流式不返回 usage 时，用 `content.length/4` 估算 outputTokens
- 至少确保 output 不为 0（虽然精度有限）

### 4.3 兼容度不足的地方

**1. 小众提供商可能不支持 `stream_options`** ⚠️
- `stream_options` 是 OpenAI 2023 年底才加入的功能
- 部分 OpenAI 兼容 API（如自部署的 vLLM、Ollama 旧版本）可能忽略此参数
- 结果：流式请求无 usage → 触发 `content.length/4` fallback（仅 output，input=0）

**2. Anthropic 流式的 `message_start` 可能被 tail buffer 截断** ⚠️
- `message_start`（含 input_tokens）在流开头发送
- tail buffer 只保留最后 4KB，超过时 `message_start` 被丢弃
- 结果：`inputTokens = 0`，Anthropic adapter 返回 `undefined`（因为 line 47 要求两者之一>0）
- **但**：`message_delta`（含 output_tokens）在流末尾，通常能被捕获
- **实际影响**：proxy 路径上 Anthropic 流式请求可能 `inputTokens=0`

**3. 格式转换路径下流式 usage 不完整** ⚠️
- `response-converter.ts` 的 OpenAI→Anthropic 流式转换只提取 `completion_tokens`
- `prompt_tokens` 在转换过程中丢失
- **但关键点**：provider-executor 的 usage 提取是对**原始上游响应**的 tail buffer 做的，不是对转换后的流
- 所以**计费不受影响**，只是客户端收到的转换后的流中 usage 不完整

### 4.4 各提供商实际兼容性

| 提供商 | 非流式 usage | 流式 usage | 已知问题 |
|--------|-------------|-----------|----------|
| DeepSeek | ✅ 完整 | ✅ 支持 stream_options | 无 |
| MiniMax | ✅ 完整 | ✅ 支持 stream_options | 无 |
| Kimi/Moonshot | ✅ 完整 | ✅ 支持 stream_options | 无 |
| Kimi Coding | ✅ 完整 | ✅ 支持 stream_options | 无 |
| OpenAI | ✅ 完整 | ✅ 支持 stream_options | 无 |
| Anthropic | ✅ 完整 | ⚠️ inputTokens 可能被截断 | tail buffer 4KB 限制 |

**结论**：对当前已接入的提供商，兼容度较好。主要风险在 Anthropic 流式路径的 input_tokens 丢失，以及未来接入不支持 `stream_options` 的小众提供商时的 fallback 精度。

---

## 五、优化建议优先级

| 优先级 | 问题 | 建议 | 改动范围 |
|--------|------|------|----------|
| **P0** | Usage 缺失时静默免费 | 增加 fallback 估算 + 告警日志 + settlement 标记 estimated | provider-executor.ts, settlement |
| **P1** | Anthropic 流式 inputTokens 可能被 tail buffer 截断 | 在流开始时额外捕获 message_start 的 input_tokens，不依赖 tail buffer | provider-executor.ts |
| **P1** | estimateTokens 对中文严重低估 | 区分 CJK/ASCII 的估算公式 | context-manager.ts |
| **P2** | content.length/4 fallback 中文不准 | 同 P1 的 CJK 感知估算 | packages/core openai.ts |
| **P2** | 无法审计 usage 来源 | settlement 记录中增加 usage_source 字段（api_reported / estimated / fallback） | DB migration + settlement |

---

## 六、Kimi input_tokens=0 Bug 修复状态

### 历史 Bug

commit `62fb697` (2026-03-30) 修复了 Kimi input_tokens=0 问题：
- **根因**：旧版 openai adapter 仅检查 `parsed.usage?.prompt_tokens !== undefined`，如果 Kimi 返回 `input_tokens` 而非 `prompt_tokens`，则提取失败
- **修复**：adapter 增加多字段 fallback：`prompt_tokens → input_tokens → cache_read + cache_creation`
- **已确认**：Kimi 实际返回双格式（`prompt_tokens` + `input_tokens`），修复后两者都能匹配

### 修复覆盖范围

| 路径 | 文件 | 修复状态 | 说明 |
|------|------|----------|------|
| **Proxy 路径** | `adapters/openai.ts` | ✅ 已修复 | 多字段 fallback + cache tokens |
| **Proxy 路径** | `adapters/anthropic.ts` | ✅ 已修复 | 同样的 fallback 逻辑 |
| **Chat 路径** | `packages/core/src/providers/openai.ts:96-102` | ⚠️ **未完全修复** | 仅读 `prompt_tokens`，无 fallback |

### Chat 路径的残留问题

`packages/core/src/providers/openai.ts` line 96-102:
```typescript
if (payload?.usage) {
  usage = {
    inputTokens: payload.usage.prompt_tokens ?? 0,   // ← 仅读 prompt_tokens
    outputTokens: payload.usage.completion_tokens ?? 0,
    totalTokens: payload.usage.total_tokens ?? 0
  };
}
```

**对 Kimi 无影响**（因为 Kimi 返回双格式字段），但如果有提供商**只返回 `input_tokens` 不返回 `prompt_tokens`**，chat 路径的 input 仍然会为 0。

**建议**：将 `packages/core` 的 usage 提取逻辑与 `adapters/openai.ts` 对齐：
```typescript
inputTokens: (payload.usage.prompt_tokens ?? payload.usage.input_tokens ??
  ((payload.usage.cache_read_input_tokens ?? 0) + (payload.usage.cache_creation_input_tokens ?? 0))) || 0,
outputTokens: payload.usage.completion_tokens ?? payload.usage.output_tokens ?? 0,
```

---

## 七、总结

**平台当前 token 统计的核心设计是正确的** — 依赖上游 API 返回的 usage 字段进行计费，这是业界标准做法。所有主流厂商（OpenAI、Anthropic、DeepSeek、Google）都以服务端返回的 token 数为计费依据。

**主要风险在于异常路径**：当上游不返回 usage 或提取失败时，平台会以 0 token 结算（等于免费），且无告警。这是最需要修复的问题。

**估算公式对中文场景不友好**，但由于估算仅用于上下文管理（非计费），影响有限。不过如果将来用估算作为 fallback 计费，则必须修复。
