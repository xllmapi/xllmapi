# 模型响应归一化 — 统一 Chat 数据格式

> 版本: v0.0.2 | 日期: 2026-03-24

## 问题

不同模型厂商返回的 SSE 流式响应格式不一致：

| 厂商 | 思考过程字段 | 回答字段 |
|------|------------|---------|
| DeepSeek R1 | `delta.reasoning_content` | `delta.content` |
| Kimi Coding | `delta.reasoning_content` | `delta.content`（可能为空） |
| OpenAI o1 | 内部思考不暴露 | `delta.content` |
| Anthropic | `content_block_delta` (text) | `content_block_delta` (text) |
| 通用 OpenAI | 无 | `delta.content` |

前端 Chat 只解析 `delta.content`，导致使用 `reasoning_content` 的模型（Kimi Coding）回复为空。

## 解决方案

### 归一化层

在后端（节点 executor + 平台 OpenAI provider）统一处理：

```
模型原始响应                    归一化后
─────────────                  ──────────
reasoning_content: "思考中..."  → <think>思考中...</think>
content: "回答"                 → 回答

最终发给前端的 delta 流:
  <think>思考过程...</think>实际回答内容
```

### 实现位置

1. **节点 CLI executor** (`apps/node-cli/src/executor.ts`)
   - 解析 SSE delta 时，检测 `reasoning_content` 和 `content`
   - `reasoning_content` 出现时插入 `<think>` 开标签
   - `content` 出现时插入 `</think>` 闭标签
   - 流结束时如果 `<think>` 未关闭，自动补 `</think>`

2. **平台 OpenAI provider** (`apps/platform-api/src/core/providers/openai.ts`)
   - 同样的归一化逻辑
   - 适用于平台直接代理调用的场景

### 前端处理

前端 Chat 的 `ChatMessage` 组件已有 `parseThinking()` 函数：

```typescript
// apps/web/src/pages/chat/components/ChatMessage.tsx
function parseThinking(content: string) {
  // 解析 <think>...</think> 标签
  // 返回 { thinking, answer, isThinking }
}
```

- `thinking` 内容显示在可折叠的灰色区域
- `answer` 内容正常显示
- 流式传输中 `isThinking=true` 表示还在思考

### 数据流

```
Kimi API → SSE: { delta: { reasoning_content: "思考" } }
         → SSE: { delta: { content: "回答" } }
              ↓
归一化层 → delta: "<think>"
         → delta: "思考"
         → delta: "</think>"
         → delta: "回答"
              ↓
平台转发 → SSE: { choices: [{ delta: { content: "<think>" } }] }
         → SSE: { choices: [{ delta: { content: "思考" } }] }
         → SSE: { choices: [{ delta: { content: "</think>" } }] }
         → SSE: { choices: [{ delta: { content: "回答" } }] }
              ↓
前端解析 → parseThinking() → 思考区域 + 回答区域
```

## 支持的模式

| 模式 | 前端显示 |
|------|---------|
| 纯 content（大多数模型） | 直接显示回答 |
| reasoning_content + content（Kimi, DeepSeek R1） | 折叠思考 + 显示回答 |
| 纯 reasoning_content（某些 coding 模型） | 显示思考过程（无正式回答） |
| content 中自带 `<think>` 标签（DeepSeek Chat） | 同样解析显示 |

## 原则

- **归一化在后端做**，前端只处理统一的 `<think>` 标签格式
- **不影响 API 服务**——xllmapi 的 `/v1/chat/completions` API 返回原始格式给外部调用者
- **只影响 Chat 前端**——通过内部 stream 转发时做归一化
