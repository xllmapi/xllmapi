# xllmapi Launch MVP

## Goal

将当前原型收敛为可上线 MVP，而不是完整市场系统。

## P0

- `XLLMAPI_ENV=production` 时强制要求 `XLLMAPI_SECRET_KEY`
- offering 默认 `pending`，只有 `approved` 才能参与 `/v1/models` 与真实路由
- 管理员可审核 pending offering
- `POST /v1/chat/completions` 支持基础每分钟限流
- 非流式 chat 支持 `Idempotency-Key`
- provider credential / offering 的关键变更写入 audit log

## P1

- Postgres migration SQL 与执行脚本
- Postgres repository 替换 SQLite
- Redis 限流与幂等缓存
- 请求取消、熔断、fallback 健康度
- 真实管理员后台页面
- 更细粒度 API key 权限
- Docker Compose 本地部署骨架，默认使用 `Postgres + Redis`
- `/metrics` 指标出口

## P2

- 预扣与冲正账本
- 多租户
- 可观测系统
- 多实例部署
