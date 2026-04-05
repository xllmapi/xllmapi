# 日志与可观测性整体增强方案

**日期**: 2026-04-05
**状态**: 进行中

## Context

当前平台可观测性存在系统性盲区：结构化 logger 已存在但几乎未使用，43 处 console 调用格式不一致，24+ 处静默 catch 吞掉错误，无 HTTP access log，关键业务路径（路由选择/结算/认证）完全无日志。

## Phase 1：HTTP Access Log + 静默 catch 修复
- 1.1 main.ts 添加请求级 access log（method/path/status/duration/requestId）
- 1.2 修复 24+ 处静默 catch（至少 warn 级别日志）
- 1.3 现有 console.error 补充 requestId 上下文

## Phase 2：关键业务路径日志
- 2.1 router.ts 路由选择决策日志
- 2.2 结算操作日志（成功/失败含金额详情）
- 2.3 认证决策日志（登录/API key/速率限制）

## Phase 3：统一 Logger + 指标补全
- 3.1 console → 结构化 logger 迁移
- 3.2 修复 logger child() 上下文继承
- 3.3 激活未使用指标 + 新增指标

## 本地模拟测试

### 测试 1: 结构化 HTTP access log
- POST /v1/chat/completions → JSON log: `{"level":"warn","message":"http","requestId":"...","method":"POST","path":"/v1/chat/completions","status":404,"durationMs":135}`
- 健康检查路径 (/healthz, /readyz, /metrics) 被过滤不输出

### 测试 2: 认证失败日志
- 错误密码登录 → `[auth] password login failed: email=... code=invalid_credentials ip=...`

### 测试 3: 启动/关闭日志
- 启动 → JSON: `{"level":"info","message":"listening on http://0.0.0.0:3000"}`

### 测试 4: 新 Prometheus 指标
- `/metrics` 输出包含 `xllmapi_failed_api_requests`, `xllmapi_daily_limit_exhausted`, `xllmapi_provider_errors`

### 测试 5: 构建 + 单元测试
- `npm run build` 通过
- 242 tests pass, 0 fail
