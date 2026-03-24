# OpenCode 配置 xllmapi

> 适用版本: OpenCode Zen 1.3.0+

## 概述

xllmapi 提供三种 API 端点，对应不同的客户端 SDK：

| 端点 | 格式 | SDK | 用途 |
|------|------|-----|------|
| `/v1/chat/completions` | OpenAI | `@ai-sdk/openai-compatible` | DeepSeek 等 OpenAI 兼容模型 |
| `/anthropic/v1/messages` | Anthropic | `@ai-sdk/anthropic` | 原生 thinking 支持（MiniMax 等） |
| `/xllmapi/v1/chat/completions` | 统一 | 自动识别 | 同一 baseURL 支持两种格式 |
| `/xllmapi/v1/messages` | 统一 | 自动识别 | 同上 |

## 配置文件

编辑 `~/.config/opencode/opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "xllmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "xllmapi (OpenAI)",
      "options": {
        "baseURL": "http://localhost:3000/xllmapi/v1",
        "apiKey": "<YOUR_XLLMAPI_API_KEY>"
      },
      "models": {
        "deepseek-chat": {
          "name": "DeepSeek Chat",
          "tool_call": true,
          "limit": { "context": 128000, "output": 8192 }
        },
        "MiniMax-M2.5": {
          "name": "MiniMax M2.5",
          "reasoning": true,
          "tool_call": true,
          "limit": { "context": 196608, "output": 24576 }
        },
        "MiniMax-M2.7": {
          "name": "MiniMax M2.7",
          "reasoning": true,
          "tool_call": true,
          "limit": { "context": 204800, "output": 131072 }
        }
      }
    },
    "xllmapi-anthropic": {
      "npm": "@ai-sdk/anthropic",
      "name": "xllmapi (Anthropic)",
      "options": {
        "baseURL": "http://localhost:3000/xllmapi/v1",
        "apiKey": "<YOUR_XLLMAPI_API_KEY>"
      },
      "models": {
        "MiniMax-M2.5": {
          "name": "MiniMax M2.5",
          "reasoning": true,
          "tool_call": true,
          "limit": { "context": 196608, "output": 24576 }
        },
        "MiniMax-M2.7": {
          "name": "MiniMax M2.7",
          "reasoning": true,
          "tool_call": true,
          "limit": { "context": 204800, "output": 131072 }
        }
      }
    }
  },
  "model": "xllmapi/deepseek-chat"
}
```

## 重要说明

### 清除环境变量

配置 Anthropic 格式前，确保清除以下环境变量避免冲突：

```bash
unset ANTHROPIC_AUTH_TOKEN
unset ANTHROPIC_BASE_URL
```

### API Key 获取

登录 xllmapi 控制台 → API Key 管理 → 创建新 Key。

### 两个 Provider 的区别

- **xllmapi (OpenAI)** — 通过 `/xllmapi/v1/chat/completions` 调用，适合 DeepSeek 等不需要 thinking UI 的模型
- **xllmapi-anthropic (Anthropic)** — 通过 `/xllmapi/v1/messages` 调用，MiniMax 的 thinking 内容会以原生 Anthropic thinking block 返回，OpenCode 能正确显示 Thinking UI

### 统一端点

两个 provider 都使用 `/xllmapi/v1` 作为 baseURL。平台根据请求路径（`/chat/completions` vs `/messages`）自动识别格式，无需手动指定。

也支持通过 `x-api-format` header 显式指定格式：

```bash
curl http://localhost:3000/xllmapi/v1/chat \
  -H "x-api-format: anthropic" \
  -H "Authorization: Bearer <KEY>" \
  -d '...'
```

### Model limit 配置

`limit.context` 和 `limit.output` 必须手动配置。OpenCode 内置快照只覆盖官方 provider 的模型，自定义 provider 的模型不会自动匹配。

| 模型 | context | output |
|------|---------|--------|
| deepseek-chat | 128,000 | 8,192 |
| MiniMax-M2.5 | 196,608 | 24,576 |
| MiniMax-M2.7 | 204,800 | 131,072 |
| kimi-for-coding | 262,144 | 8,192 |
