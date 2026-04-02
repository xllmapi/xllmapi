# API 错误响应格式合规优化

## 问题

所有错误响应使用自定义格式 `{error: {message, requestId}}`，不符合 OpenAI/Anthropic 规范。
客户端 SDK 按规范解析错误时可能失败。

## 方案

新增 `formatApiError()` 函数，根据 clientFormat 生成规范错误 + xllmapi 扩展字段：

- OpenAI: `{error: {message, type, param, code}, xllmapi: {requestId, ...}}`
- Anthropic: `{type: "error", error: {type, message}, xllmapi: {requestId, ...}}`

## 涉及文件

| 文件 | 变更 |
|------|------|
| `src/lib/errors.ts` | 新增 formatApiError + HTTP→错误类型映射 |
| `src/routes/api-proxy.ts` | 所有错误响应改用 formatApiError |
| `src/routes/chat.ts` | 流式错误改用规范格式 |
| `src/tests/error-format.test.ts` | 新建：错误格式测试集 |

## 本地模拟测试

- [x] formatApiError OpenAI 格式正确
- [x] formatApiError Anthropic 格式正确
- [x] xllmapi 扩展字段正确携带
- [x] HTTP 状态码到错误类型映射正确
- [x] 全量单元测试通过 (174/174)

## 状态: ✅ 已完成

PR: https://github.com/Sunrisepeak/xllmapi/pull/70 (已合入 main)
