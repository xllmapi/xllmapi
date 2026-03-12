---
name: xllm-stream-contract
description: 约束 xllmapi 流式 SSE 协议、chunk 透传、终结事件、断流处理和结算元数据。适用于修改 chat-stream 接口、SSE 事件格式或 TS 平台层与 C++ core 的流式边界时。
---

# xllm-stream-contract

用于 xllmapi 的流式事件协议设计与审查。

## 何时使用

- 新增或修改 `chat-stream`
- 调整 SSE 事件名或 payload
- 修改 TS 平台层透传逻辑
- 修改流式结算逻辑

## 默认协议

- `event: meta`
- `event: chunk`
- `event: completed`
- `event: error`

## 关键原则

1. `completed` 与 `error` 二选一，必须出现其一
2. `completed` 中必须包含 usage
3. TS 平台层不重组 chunk
4. 客户端断开要有可追踪状态

## 输出要求

- 说明事件顺序
- 说明结算依赖哪个终结事件
- 说明断流后如何收尾
