# xllmapi API Contracts

## Public API

### `POST /v1/chat/completions`

OpenAI-compatible chat 接口。

### `GET /v1/models`

返回平台逻辑模型，不暴露底层真实 provider model。

## Internal API

### `POST /internal/core/route-execute/chat`

TS 平台层调用 C++ core 的非流式接口。

关键字段：

- `request_id`
- `trace_id`
- `logical_model`
- `routing_mode`
- `request_payload`
- `candidate_offerings`

### `POST /internal/core/route-execute/chat-stream`

TS 平台层调用 C++ core 的流式接口。

## Stream events

- `meta`
- `chunk`
- `completed`
- `error`

`completed` 必须带 usage 与 chosen offering 信息。
