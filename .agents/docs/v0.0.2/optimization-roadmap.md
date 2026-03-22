# xllmapi 全面审计 + 阶段性优化方案

## 项目现状总览

| 维度 | 状态 | 关键数字 |
|------|------|---------|
| 后端 | main.ts 2321 行单文件，49 个路由 | 8600+ 行总代码 |
| 前端 | 14 页面，55 个 TSX 文件，724KB bundle | 无代码分割 |
| 数据库 | 16 张表，5 个迁移，7 个索引 | 缺少关键索引 |
| 测试 | 1 个单元测试（44 行），2 个 E2E 脚本 | 近零覆盖 |
| CI/CD | 无 | 无自动化 |
| 安全 | 无 CORS、无安全头、无密钥轮换 | 多个生产阻断项 |

---

## Phase 1: 生产阻断项修复（1 周）

> 不修这些就不能上线

### 1.1 安全基础
- [ ] **CORS 支持**：main.ts 添加 `Access-Control-*` 头，支持跨域请求
- [ ] **安全头**：CSP、X-Frame-Options、X-Content-Type-Options、HSTS
- [ ] **钱包预检**：发起请求前检查余额，不足时拒绝（当前可透支为负）
- [ ] **结算失败补偿**：provider 成功但 settlement 失败时，记录待重试队列

### 1.2 数据库索引（性能）
- [ ] `api_requests(requester_user_id, created_at DESC)` — 消费查询
- [ ] `api_requests(chosen_offering_id, created_at DESC)` — 供应查询
- [ ] `api_requests(created_at DESC)` — 趋势/管理查询
- [ ] `settlement_records(consumer_user_id, created_at DESC)`
- [ ] `settlement_records(supplier_user_id, created_at DESC)`
- [ ] `ledger_entries(user_id, created_at DESC)` — 钱包余额
- [ ] `chat_conversations(owner_user_id, updated_at DESC)` — 对话列表

### 1.3 .gitignore + 环境配置
- [ ] 添加 `*.db`、`.superpowers/`、`*.log`、`*.pid` 到 .gitignore
- [ ] 创建 `.env.example`：列出所有 12 个环境变量 + 说明
- [ ] 价格字段添加 CHECK 约束：`fixed_price_per_1k_input >= 0`

### 1.4 前端关键修复
- [ ] **i18n 硬编码**：ChatMessage.tsx 里 "思考中…"/"思考过程" 改用 i18n key
- [ ] **formatTokens 去重**：NetworkPage 里的本地函数删除，统一用 `@/lib/utils`
- [ ] **Dashboard 移动端**：侧栏 `w-[180px]` 加 `hidden md:block`，移动端用 tab bar

---

## Phase 2: 架构重构（2 周）

> 从单文件走向可维护结构

### 2.1 后端路由拆分
当前 main.ts 2321 行，49 个路由全在一个文件。拆分为：

```
apps/platform-api/src/
├── main.ts              ← 缩减到 ~100 行（启动+中间件）
├── middleware/
│   ├── cors.ts          ← CORS + 安全头
│   ├── auth.ts          ← 认证中间件
│   └── rate-limit.ts    ← 限速（已有，移入）
├── routes/
│   ├── auth.ts          ← 5 个 auth 路由
│   ├── chat.ts          ← 7 个 chat 路由
│   ├── user.ts          ← 9 个 user/invitation 路由
│   ├── provider.ts      ← 6 个 provider/credential 路由
│   ├── offering.ts      ← 4 个 offering 路由
│   ├── usage.ts         ← 8 个 usage/wallet 路由
│   ├── network.ts       ← 5 个公开 model/trend 路由
│   ├── admin.ts         ← 6 个 admin 路由
│   └── public.ts        ← 2 个公开 supplier 路由
├── core/                ← 保持不变
├── services/            ← 保持不变
└── repositories/        ← 保持不变
```

### 2.2 错误处理标准化
- [ ] 定义 `AppError` 类：`{ code, message, statusCode, details }`
- [ ] 统一错误码枚举：`INSUFFICIENT_BALANCE`, `PROVIDER_UNAVAILABLE`, `RATE_LIMITED` 等
- [ ] 全局错误处理中间件：catch all → JSON error response + 日志

### 2.3 前端代码分割
- [ ] `React.lazy()` 拆分：ChatPage、AdminPages、ModelDetailPage 按路由懒加载
- [ ] mermaid 已经是 dynamic import（保持）
- [ ] 目标：首屏 bundle < 300KB（当前 724KB）

### 2.4 结构化日志
- [ ] 替换所有 `console.log/error` 为统一 logger
- [ ] JSON 格式：`{ timestamp, level, requestId, message, context }`
- [ ] 区分 access log / error log / audit log

---

## Phase 3: 核心功能完善（2 周）

> 用户体验从可用到好用

### 3.1 对话搜索
- [ ] 后端：`GET /v1/chat/conversations/search?q=keyword`
- [ ] 前端：侧栏搜索框，关键词匹配标题+消息内容

### 3.2 对话管理增强
- [ ] System prompt 支持：conversation 表加 `system_prompt` 字段
- [ ] 对话归档/置顶
- [ ] 对话导出（Markdown）

### 3.3 API Key 管理
- [ ] 多 Key 支持：创建/删除/列出
- [ ] Key 用量限制：per-key budget cap
- [ ] Key 过期时间 + 续期

### 3.4 Admin 面板增强
- [ ] 用户搜索 + 筛选
- [ ] Provider 健康监控：成功率、延迟、熔断状态
- [ ] 系统趋势图（复用 TrendChart 组件）
- [ ] 最近请求实时流

### 3.5 更多 Provider 支持
- [ ] Groq：`openai_compatible`，baseUrl `api.groq.com/openai/v1`
- [ ] Together AI：`openai_compatible`
- [ ] 智谱 GLM：`openai_compatible`
- [ ] 用户自定义 baseUrl（已支持 `openai_compatible` 类型）

---

## Phase 4: 测试 + CI/CD（1 周）

> 从手动到自动化

### 4.1 测试覆盖
- [ ] **单元测试**：context window trimming、formatTokens、settlement 计算
- [ ] **API 测试**：每个端点的正常+异常路径（用 supertest 或 node:test）
- [ ] **E2E 测试隔离**：使用独立数据库 `xllmapi_test`，不污染开发库
- [ ] **E2E 补充**：API Key 管理、offering 审核/拒绝、余额不足场景

### 4.2 CI/CD Pipeline
```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  lint-and-type-check:
    - npm run build (includes tsc)
  unit-tests:
    - npm run test:platform-api
  e2e-tests:
    - docker compose up postgres redis
    - npm run test:e2e:mvp
  docker-build:
    - docker build -t xllmapi/platform-api .
```

### 4.3 代码质量
- [ ] ESLint 配置（TypeScript strict rules）
- [ ] Prettier 格式化
- [ ] lint-staged + husky pre-commit hooks

---

## Phase 5: 商业化准备（2 周）

> 从工具到产品

### 5.1 定价体系完善
- [ ] 动态定价建议：基于供需比自动推荐价格
- [ ] 最低价格保护：防止恶意低价
- [ ] 阶梯定价：大量消费折扣

### 5.2 xtokens 经济体系
> xtokens 是平台内部货币，供应模型获得 xtokens，消费模型花费 xtokens，形成闭环。暂不做法币充值/提现。

- [ ] 新用户初始赠送额度调整（当前 1M，可配置化）
- [ ] 供应者奖励规则优化（当前固定 85%，可根据质量评分浮动）
- [ ] xtokens 余额不足时的降级策略（提示充值 vs 限速 vs 排队）

### 5.3 质量评分
- [ ] 每次调用记录延迟 + 成功/失败（需在 api_requests 增加 `latency_ms` 列）
- [ ] 按 offering 聚合质量分：影响路由权重
- [ ] 低质量自动降权 → 通知供应商

### 5.4 公开排行榜
- [ ] `/rankings` 页面：Token 使用量排名、Market Share 面积图
- [ ] 参考 OpenRouter Rankings 风格

---

## Phase 6: 生产化部署（1 周）

### 6.1 多进程 + 水平扩展
- [ ] PM2 cluster mode 或 Node.js cluster
- [ ] Redis 用于跨进程状态共享（circuit breaker、rate limit）
- [ ] Nginx/Caddy 反向代理 + HTTPS

### 6.2 可观测性
- [ ] Prometheus metrics 扩展：per-provider 延迟、成功率
- [ ] Grafana dashboard 模板
- [ ] 错误告警（Webhook / Email）

### 6.3 文档更新
- [ ] 更新 `.agents/docs/` 为最新架构
- [ ] 创建 OpenAPI/Swagger 文档
- [ ] SDK 发布（TypeScript / Python）
- [ ] 创建 CLAUDE.md

---

## 时间线总览

```
Phase 1 ████░░░░░░░░░░░░  生产阻断项    Week 1
Phase 2 ░░░░████████░░░░  架构重构      Week 2-3
Phase 3 ░░░░░░░░████████  功能完善      Week 4-5
Phase 4 ░░░░░░░░░░░░████  测试+CI/CD    Week 6
Phase 5 ░░░░░░░░░░░░░░██████████  商业化  Week 7-8
Phase 6 ░░░░░░░░░░░░░░░░░░░░████  生产化  Week 9
```

## 优先级矩阵

| 紧急+重要 | 重要不紧急 |
|-----------|-----------|
| CORS/安全头 | 路由拆分 |
| 数据库索引 | 代码分割 |
| 钱包预检 | 对话搜索 |
| .gitignore | Provider 扩展 |
| i18n 修复 | 质量评分 |

| 紧急不重要 | 都不紧急 |
|-----------|---------|
| 结算补偿 | OpenAPI 文档 |
| 移动端适配 | SDK 发布 |
| E2E 隔离库 | 排行榜页面 |
