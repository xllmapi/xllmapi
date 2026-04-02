# Fix: Anthropic 流式响应 input_tokens=0

## 问题

Anthropic 流式响应中 `message_start` 的 `usage.input_tokens` 始终为 0。

## 根因

`createOpenaiToAnthropicStreamConverter()` 在 `message_start` 时硬编码 `input_tokens: 0`，
而 OpenAI 格式的 `prompt_tokens` 在流的最后一个 chunk 才返回。转换器虽然在最终 chunk 捕获了
`completion_tokens`，但没有捕获 `prompt_tokens`，也没有在 `message_delta` 中补发 `input_tokens`。

## 修复方案

在 `response-converter.ts` 的 `createOpenaiToAnthropicStreamConverter()` 中：

1. 新增 `inputTokens` 变量，与 `outputTokens` 并行追踪
2. 从最终 chunk 的 `usage.prompt_tokens` 中捕获值
3. 在 `message_delta.usage` 中加入 `input_tokens`

Anthropic 官方 API 也在 `message_delta` 中发送 usage 更新，客户端已支持此模式。

## 涉及文件

| 文件 | 变更 |
|------|------|
| `src/core/adapters/response-converter.ts` | 捕获 prompt_tokens + 写入 message_delta |
| `src/tests/response-converter.test.ts` | 新增测试用例 |

## 本地模拟测试

- [ ] 单元测试：验证 message_delta 包含 input_tokens
- [ ] 单元测试：验证 usage 在最终 chunk 才到达时正确捕获
- [ ] 全量单元测试通过
