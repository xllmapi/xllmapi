# 修复 OpenAI Streaming Token 计数为 0 的 Bug

## 问题

OpenAI 流式 API 默认不返回 usage，必须在请求中设置 `stream_options: { include_usage: true }`。当前 xllmapi 未注入此参数，导致所有 OpenAI upstream streaming 请求 token 计数为 0。

## 根因

`openai.ts:prepareBody()` 未在 `stream=true` 时注入 `stream_options`。

## 影响范围

| 场景 | 影响 |
|------|------|
| Client ANTHROPIC → Upstream OPENAI (streaming) | token 全为 0 |
| Client OPENAI → Upstream OPENAI (streaming, client 未带 stream_options) | token 全为 0 |
| Client OPENAI → Upstream ANTHROPIC | 不影响 |
| 任何格式 non-streaming | 不影响 |

## 修复方案

### 代码修改

**文件**: `apps/platform-api/src/core/adapters/openai.ts`

在 `prepareBody()` 中，当 `stream===true` 时自动注入 `stream_options: { include_usage: true }`：

```typescript
prepareBody(body, realModel) {
  const prepared = { ...body, model: realModel };
  if (typeof prepared.max_tokens === "number") {
    prepared.max_tokens = Math.min(prepared.max_tokens, 8192);
  }
  // Ensure streaming responses include token usage for billing
  if (prepared.stream === true && !prepared.stream_options) {
    prepared.stream_options = { include_usage: true };
  }
  return prepared;
}
```

**安全性**：
- 如果 client 已经带了 `stream_options`，不覆盖（尊重 client 设置）
- `stream_options.include_usage` 是 OpenAI 标准参数，所有兼容 API 都应支持
- hanbbq 已验证支持此参数

### 非标准供应商配置解决方案

对于 Anthropic 端点实现不规范的供应商（如 hanbbq），**不配 `anthropicBaseUrl`**，让 xllmapi 走 OpenAI 原生端点 + 自动格式转换：

| 供应商 | 当前配置 | 建议配置 |
|--------|---------|---------|
| hanbbq (OpenAI-AH) | 可能配了 anthropicBaseUrl | **只配 baseUrl**，不配 anthropicBaseUrl |
| MiniMax | baseUrl + anthropicBaseUrl | 保持不变（MiniMax Anthropic 端点需验证是否规范） |
| MiMo | 仅 Anthropic 端点 | 保持不变 + 保留 provider hook |
| DeepSeek | 仅 OpenAI 端点 | 保持不变 |
| Kimi Coding | 仅 OpenAI 端点 | 保持不变 |

**原则**：供应商的 Anthropic 端点只有在确认 token 报告规范（`message_start` 正确报告 `input_tokens`）时才配 `anthropicBaseUrl`。否则走 OpenAI 端点 + 自动转换更可靠。

### 非标准供应商配置策略

MiMo 和 hanbbq (OpenAI-AH) 的 Anthropic 流式端点都存在 `message_start.input_tokens=0` 的非标准行为，但 OpenAI 格式完全规范。

**策略**：这类供应商不配 `anthropicBaseUrl`，只配 `baseUrl`（OpenAI 端点），让 xllmapi 自动做格式转换。

| 供应商 | baseUrl | anthropicBaseUrl | 说明 |
|--------|---------|-----------------|------|
| hanbbq (OpenAI-AH) | `https://api.hanbbq.top/v1` | 不配 | Anthropic SSE 非标准 |
| MiMo | OpenAI 端点 | 不配 | Anthropic SSE 非标准，走 OpenAI 更可靠 |
| MiniMax | 保留 | 需验证后决定 | 待确认 Anthropic 端点是否规范 |
| DeepSeek | 只有 OpenAI | N/A | 不受影响 |
| Kimi Coding | 只有 OpenAI | N/A | 不受影响 |

MiMo 的 provider hook 保留不删——作为防御性代码，万一将来有供应商只能走 Anthropic 端点时仍可用。

## 验证结果

1. `npm run build` 编译通过
2. `npm run test:platform-api` 单元测试通过
3. 本地 dev 验证：
   - [x] `stream_options` 正确注入到 OpenAI streaming 请求
   - [x] Client 已带 stream_options 时不被覆盖
   - [x] Non-streaming 不受影响
4. E2E 测试通过
