# 上下文管理优化

> 版本: v0.0.2 | 日期: 2026-03-24

## 问题

1. `<think>` 内容被存入 chat_messages，作为历史上下文发给 LLM → 上下文膨胀 3-10 倍
2. Kimi 等新模型没有配置上下文窗口大小
3. 用户/前端看不到上下文使用情况

## 方案

### 1. 发送前剥离 thinking 内容

DB 保留完整内容（前端展示用），发送给 LLM 时剥离 `<think>...</think>` 标签。

```typescript
function stripThinking(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
```

应用于构建上下文消息时，只对 assistant 消息剥离。

### 2. 模型上下文配置

硬编码默认值 + API 自动获取优先：

| 模型 | 上下文 |
|------|--------|
| deepseek | 64K |
| minimax | 200K |
| gpt-4o | 128K |
| claude | 200K |
| kimi | 128K |
| kimi-for-coding | 262K |
| moonshot | 128K |
| 默认 | 64K |

offerings 表增加 `context_length` 字段，discovery 时从 API 获取 `context_length`。

### 3. 前端显示上下文

- **Chat 输入框**: `上下文: 2.1K / 128K tokens` + 变色警告
- **模型网络卡片**: `上下文 64K`
- **模型详情页**: `最大上下文: 64K tokens`
- **节点详情页**: `上下文: 262K tokens`
- **控制台节点管理卡片**: `上下文 262K`
- **连接管理卡片**: `64K`
