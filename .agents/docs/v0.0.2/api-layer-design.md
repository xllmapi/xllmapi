# API 适配层独立设计方案

> 版本: v0.0.2 | 日期: 2026-03-24

## 背景

当前 `/v1/chat/completions`（OpenAI 兼容）和 `/v1/messages`（Anthropic 兼容）混在 `chat.ts` 里，
和平台内部 chat（conversation 管理、stripThinking、context trim）耦合。

问题：
1. `proxyApiRequest` 做 raw pipe 没提取 usage → token 统计全为 0
2. API 代理丢弃了 `tools`/`tool_choice` 等标准参数（已修复透传）
3. 对外 API 和内部 chat 逻辑混在同一文件（800+ 行）

## 目标架构

```
routes/
  api-proxy.ts    ← 对外 API 适配层（OpenAI + Anthropic 兼容）
  chat.ts         ← 平台前端 chat（conversation CRUD + stream）
```

### api-proxy.ts 职责

- `POST /v1/chat/completions` — OpenAI 兼容透传代理
- `POST /v1/messages` — Anthropic 兼容适配代理
- 认证 + 限流 + 钱包检查 + offering 选择
- 请求 body 原样透传给 provider（包括 tools、tool_choice 等）
- provider 响应 raw pipe 回客户端
- **在 pipe 过程中提取 usage** 用于结算
- 不做 conversation 管理、不做 stripThinking、不做 context trim

### chat.ts 精简后只保留

- `POST /v1/chat/conversations` — 创建对话
- `POST /v1/chat/conversations/:id/stream` — 平台 chat 流式（带 context trim + stripThinking）
- `GET /v1/chat/conversations` — 对话列表
- `PATCH /v1/chat/conversations/:id` — 更新对话
- `DELETE /v1/chat/conversations/:id` — 删除对话
- `GET /v1/chat/conversations/:id/messages` — 消息列表

## Usage 提取方案

### Streaming (SSE)

```
SSE 流结构:
  data: {"choices":[...]}\n\n                              ← delta chunks
  data: {"choices":[...],"usage":{"prompt_tokens":6,...}}\n\n  ← 最后一个 chunk
  data: [DONE]\n\n

提取:
  1. PassThrough stream pipe 给客户端（零延迟）
  2. on('data') 维护 tail buffer（最后 4KB）
  3. on('end') 从 buffer 正则提取 usage JSON
  4. 返回 { prompt_tokens, completion_tokens, total_tokens }
```

### Non-streaming (JSON)

```
读取完整 body → JSON.parse → 提取 .usage → 原始 body 写回客户端
```

## 修改文件

| 文件 | 改动 |
|------|------|
| `routes/api-proxy.ts` | **新建** — 独立 API 路由 |
| `core/provider-executor.ts` | 修改 `proxyApiRequest` — pipe 中提取 usage |
| `routes/chat.ts` | 删除 `/v1/chat/completions` 和 `/v1/messages` |
| `routes/index.ts` | 添加 `handleApiProxyRoutes` 导出 |
| `main.ts` | 注册 `handleApiProxyRoutes`（在 chat 之前） |

## 设计原则

1. **API 层是纯代理** — 不做任何消息内容处理
2. **平台 chat 是消费者之一** — 有自己的 conversation 管理和 context 处理
3. **usage 提取不阻塞响应** — 客户端收到的是原始 provider stream
4. **settlement 异步执行** — 不影响响应延迟
