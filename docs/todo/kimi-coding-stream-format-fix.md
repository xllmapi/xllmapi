# Kimi Code API 请求成功无输出 - 分析与修复方案

**日期**: 2026-03-30
**状态**: 待实施
**分支**: `fix/kimi-coding-stream-format-autodetect`

---

## 问题描述

opencode 通过 xllmapi 平台代理请求 `kimi-for-coding`（Anthropic 格式），请求返回 HTTP 200，settlement 记录 572 output tokens，但客户端无文本输出。

请求详情：
- Client Format: ANTHROPIC
- Upstream Format: OPENAI
- Format Converted: Yes
- Output Tokens: 572
- 客户端 UA: `opencode/1.3.7 ai-sdk/provider-utils/4.0.21 runtime/bun/1.3.11`
- 上游 UA: `claude-cli/2.1.87`（force mode 生效）

---

## 根因分析

### 根因 1：offering 查询未继承 preset 的 anthropicBaseUrl

**文件**: `apps/platform-api/src/repositories/postgres-platform-repository.ts`

Admin 已在 preset 上配置 `Anthropic URL: https://api.kimi.com/coding/v1`，但 offering 查询只从 credential 读取 `anthropic_base_url`，未 COALESCE preset 的值。

对比：
```sql
-- customHeaders 正确使用了 COALESCE（line 1871）
COALESCE(p.custom_headers, c.custom_headers) AS "customHeaders"

-- anthropicBaseUrl 只从 credential 读取（line 1851）—— BUG
c.anthropic_base_url AS "anthropicBaseUrl"
```

credential 创建于 preset 配置 anthropicBaseUrl 之前，因此 credential 上该字段为 NULL。

**后果**：`resolveEndpoint()` 无法找到 Anthropic 端点，强制走 OpenAI 格式转换路径。

### 根因 2：OpenAI→Anthropic 流转换器无法解析 Kimi 响应

被迫走格式转换后，`createOpenaiToAnthropicStreamConverter()` 解析 Kimi 的 OpenAI 端点返回的 SSE。

两个子问题：

**a) Kimi 可能返回 Anthropic 格式 SSE**

Kimi 本质上是 Anthropic 兼容 API，其 `/v1/chat/completions` 端点可能返回 Anthropic 格式事件：
```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"3"}}
```

转换器期望 OpenAI 格式（`choices[0].delta.content`），遇到 Anthropic 事件时因无 `choices` 字段静默返回空：
```typescript
const choice = choices[0];
if (!choice) return results;  // ← 所有 Anthropic 事件被跳过
```

**b) Kimi 返回 reasoning_content**

Kimi 支持推理（`supports_reasoning: true`），可能将大部分内容放在 `reasoning_content` 字段：
```json
{"choices":[{"delta":{"reasoning_content":"让我计算1+2..."},"finish_reason":null}]}
```

转换器只处理 `delta.content`，`reasoning_content` 被忽略。

**为什么 token 仍被正确记录**：Kimi 的 usage 对象包含双格式字段（`prompt_tokens` + `input_tokens`），OpenAI adapter 的 `extractUsageFromStream()` 能匹配 `prompt_tokens`。

---

## 修复方案

### Part 1：Preset 配置同步

**文件**: `apps/platform-api/src/repositories/postgres-platform-repository.ts`

`findOfferingsForModel` (line 1851) 和 `findUserOfferingsForModel` (line 1905)：
```sql
COALESCE(p.anthropic_base_url, c.anthropic_base_url) AS "anthropicBaseUrl"
```

### Part 2：上游响应格式自动识别

**文件**: `apps/platform-api/src/core/adapters/response-converter.ts`

新增 `createAutoDetectStreamConverter`：缓冲前 512 字节，检测实际格式（Anthropic vs OpenAI），动态选择转换器。

检测规则：
- `event: message_start` 或 `event: content_block` → Anthropic
- `"choices":` → OpenAI
- 默认回退到预期格式

### Part 3：reasoning_content 处理

**文件**: `apps/platform-api/src/core/adapters/response-converter.ts`

在 OpenAI→Anthropic 转换器中增加 `reasoning_content` 支持，转为 `content_block_delta` 事件。

### Part 4：Anthropic 端点认证头兼容

**文件**: `apps/platform-api/src/core/provider-executor.ts`

支持 `customHeaders.authMode: "bearer"`，将 `x-api-key` 转换为 `Authorization: Bearer` 格式。新增 `$AUTH_BEARER` placeholder。

---

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `postgres-platform-repository.ts:1851,1905` | COALESCE anthropicBaseUrl |
| `response-converter.ts` | 新增 autoDetect converter + reasoning_content |
| `provider-executor.ts:304` | 启用 autoDetect |
| `provider-executor.ts:163-200` | authMode bearer |

---

## 验证

1. Unit tests：格式检测、转换器、reasoning_content
2. 端到端：通过 xllmapi 代理请求 kimi-for-coding，验证 Anthropic 客户端有输出
3. 回归：现有 OpenAI/Anthropic 提供商仍正常工作
