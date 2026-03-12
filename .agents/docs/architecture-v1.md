# xllmapi Architecture v1

## Overview

xllmapi 采用双层后端：

- `apps/platform-api`：TS 平台层，负责账户、API key、offerings、账本、审计、外部网关。
- `apps/core-router-executor`：C++ core，负责路由、provider 凭证解密、真实模型调用、fallback、usage 采集。

前端位于 `apps/web`，负责官网、控制台和管理后台。

## Core decisions

- 不做支付
- 不做独立 T 币
- 平台余额单位为 `token credit`
- 真实 provider key 不暴露给消费者
- provider key 在 C++ core 内解密并使用
- 流式输出由 C++ core 生成，TS 平台层透传

## Main request flow

1. 客户端请求 `platform-api`
2. TS 完成鉴权、限流、余额预检查
3. TS 查询逻辑模型和候选 offerings
4. TS 调用 C++ core 内部接口
5. C++ core 路由并执行真实 provider 请求
6. C++ core 返回统一结果与 usage
7. TS 完成账本结算和请求记录
8. TS 返回 OpenAI-compatible 响应

## Primary stacks

- Web: Next.js + TypeScript
- Platform API: NestJS + PostgreSQL + Redis
- Core: C++23 + llmapi + tinyhttps + xmake
