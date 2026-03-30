# Thinking/Reasoning 跨格式支持

**日期**: 2026-03-30
**状态**: 实施中
**分支**: `fix/thinking-cross-format-support`

---

## 问题

不同供应商在 OpenAI/Anthropic 格式端点上实现 thinking 的方式不同：

| 供应商 | OpenAI 端点 | Anthropic 端点 |
|--------|------------|---------------|
| Kimi | `reasoning_content` 字段（默认启用） | `thinking_delta` 块（需请求中带 `thinking` 参数） |
| MiniMax | `<think>` 标签嵌入 content | `thinking_delta` 块 |
| DeepSeek | `reasoning_content` 字段 | N/A |

平台在格式转换时存在两个问题：
1. **请求 body 转换丢弃 thinking 字段** — `converter.ts` 只映射有限字段
2. **Anthropic→OpenAI 流转换器忽略 thinking_delta** — content_block_delta 只处理 text_delta

---

## 修复方案

### Fix 1：请求 body 转换保留 thinking 字段

`converter.ts` 中两个方向的转换都需要透传 thinking 相关字段：

- `openaiToAnthropic()`: 如果 body 中有 thinking/reasoning 相关字段，保留
- `anthropicToOpenai()`: 如果 body 中有 thinking 字段，保留

### Fix 2：Anthropic→OpenAI 流转换器处理 thinking_delta

`response-converter.ts` 中 `createAnthropicToOpenaiStreamConverter` 增加 `thinking_delta` 处理，映射为 `reasoning_content` 字段。

---

## 修改文件

| 文件 | 改动 |
|------|------|
| `apps/platform-api/src/core/adapters/converter.ts` | 透传 thinking 字段 |
| `apps/platform-api/src/core/adapters/response-converter.ts` | thinking_delta → reasoning_content |
| `apps/platform-api/src/tests/request-converter.test.ts` | 新增 thinking 字段测试 |
| `apps/platform-api/src/tests/response-converter.test.ts` | 新增 thinking_delta 测试 |
