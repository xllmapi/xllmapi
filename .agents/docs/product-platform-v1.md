# xllmapi Product Platform v1

This document supersedes earlier frontend/product direction docs for the current platform design.

## Core definition

- CN: `一个连接所有模型的 LLM API 共享网络与平台。`
- EN: `A shared LLM API network and platform that connects you to all models.`

## Core outcome

- CN: `拥有一个 LLM API，即可连接所有模型。`
- EN: `Bring one LLM API, connect to all models.`

## Core mechanism

1. 用户接入自己已有的一家模型 API。
2. 平台把这份能力纳入共享网络。
3. 该能力被调用后，为用户结算 `llmapi token`。
4. 用户再使用这些 `llmapi token` 去调用其他模型。

## Public product surfaces

1. `/`
2. `/market`
3. `/u/:handle`
4. `/docs`
5. `/auth`

## Logged-in product surfaces

1. `/app`
2. `/admin`

## Protocol compatibility

xllmapi 默认对外提供：

1. `OpenAI-compatible API`
2. `Anthropic-compatible API`

## Token model

- 平台统一结算单位：`llmapi token`
- 前端价格展示：
  - `Input: X llmapi / 1K tokens`
  - `Output: Y llmapi / 1K tokens`

## Growth model

- 邀请只能由已登录用户发起
- 普通用户最多邀请 10 人
- 管理员邀请不限
- 受邀邮箱第一次登录时自动注册

