# xllmapi v0.0.3+ 优化方向与方案

## 当前状态评估

v0.0.2 完成了核心 MVP：用户可以提交 provider key → 自动发现模型 → 接入网络 → 其他用户通过统一 API 调用。支持 4 家厂商，有基本的用量统计、结算、Chat UI。

主要短板：
- 数据质量：e2e 测试数据污染生产库
- 运营能力：无套餐/定价/支付
- 可靠性：单进程、无监控告警
- 用户增长：无公开注册、无分享机制

---

## Phase 1: 数据治理 + 稳定性（1-2 周）

### 1.1 清理测试数据
- 清除 e2e 测试创建的 users/offerings/credentials/settlements
- 或者更好的方案：e2e 测试使用独立数据库（`xllmapi_test`），不污染开发库
- 修改 `scripts/e2e-*.mjs` 使用 `DATABASE_URL` 指向独立库

### 1.2 Provider 健康监控
- 在 provider-executor 中记录每次调用的 latency、status、error
- 新增 `GET /v1/admin/provider-health` 端点：按 offering 聚合成功率、P95 延迟、错误分布
- Admin 面板增加 Provider Health 页：实时查看每个 offering 的健康状态
- 熔断状态可视化（open/closed/half-open）

### 1.3 错误重试优化
- 当前 retry 对所有 429 都重试，但不区分 rate limit 和 quota exceeded
- 增加 `Retry-After` header 解析，按厂商返回的等待时间重试
- 对 quota exceeded (402) 直接标记 offering 不可用，不重试

### 1.4 日志与可观测性
- 结构化日志（JSON 格式），区分 access log / error log / audit log
- 每个请求的完整 trace：route selection → provider call → settlement
- 接入 Prometheus metrics（已有基础 `/metrics`，扩展 provider 维度）

---

## Phase 2: 用户体验 + 增长（2-3 周）

### 2.1 多轮对话上下文管理
- 当前 conversation stream 只发送最后一条消息给 provider
- 实现上下文窗口管理：自动截断/滑动窗口保持在 provider 的 token 限制内
- 支持 system prompt 设置（per-conversation 或 per-model）

### 2.2 模型能力标签
- 在 offering 创建时自动检测模型能力：
  - 是否支持 function calling
  - 是否支持 vision（图片输入）
  - 是否有 reasoning/thinking 输出
  - 上下文窗口大小
- 前端模型卡片展示能力标签
- Chat 模型选择器按能力筛选

### 2.3 Chat UI 增强
- 消息编辑 + 重新生成（edit & regenerate）
- 多模型同时对比（split view，同一问题发给 2-3 个模型）
- 对话导出（Markdown / JSON）
- 移动端响应式适配

### 2.4 公开注册 + 邀请奖励
- 开放公开注册（可选邮箱验证 / OAuth）
- 邀请奖励机制：邀请人获得 bonus xtokens
- 注册引导流程：选择厂商 → 输入 key → 自动接入

---

## Phase 3: 商业化 + 运营（3-4 周）

### 3.1 定价与套餐
- 按模型类型定义价格梯度（base price per 1K tokens）
- 供应商定价建议（based on 市场均价 + 供需比）
- 消费者预付费套餐：充值 → 获得 xtokens → 按使用扣减
- 供应商收益结算：xtokens → 可提现余额

### 3.2 质量评分系统
- 每次调用记录：latency、成功率、用户反馈（thumbs up/down）
- 按 offering 聚合质量分数，影响路由权重
- 低质量 offering 自动降权 → 通知供应商 → 超时禁用
- Admin 面板：质量排名、趋势图

### 3.3 API Key 管理增强
- 多 API key 支持（不同用途/权限）
- Key 用量限制（per-key rate limit、per-key budget cap）
- Key rotation（自动过期 + 续期提醒）

### 3.4 供应网络扩展
- 更多厂商适配：Google Gemini、Groq、Together AI、零一万物、智谱、月之暗面
- 自定义 OpenAI-compatible 端点（用户填 baseUrl 即可）
- 私有模型支持（vLLM / Ollama self-hosted）

---

## Phase 4: 生产化（4-6 周）

### 4.1 多进程 + 水平扩展
- PM2 / cluster mode 多进程部署
- Redis 用于跨进程状态共享（circuit breaker state、rate limit counters）
- Load balancer (Nginx / Caddy) 前置

### 4.2 安全加固
- CSRF 防护
- API key 访问频率异常检测
- Provider key 泄漏检测（定期验证 key 是否仍有效）
- 审计日志完善（who did what when）

### 4.3 CI/CD
- GitHub Actions: lint + typecheck + unit test + e2e test
- 自动构建 Docker image
- Staging 环境自动部署
- Database migration 自动执行

### 4.4 文档与开发者体验
- OpenAPI/Swagger 文档自动生成
- SDK 发布（TypeScript / Python）
- 交互式 API playground
- 接入指南：5 分钟从注册到第一次 API 调用

---

## 推荐优先级

```
紧急度高 ────────────────────────────────► 紧急度低
┌───────────┐  ┌───────────┐  ┌──────────┐  ┌──────────┐
│ Phase 1   │  │ Phase 2   │  │ Phase 3  │  │ Phase 4  │
│           │  │           │  │          │  │          │
│ 数据治理   │→│ 用户体验   │→│ 商业化    │→│ 生产化    │
│ 稳定性    │  │ 增长      │  │ 运营     │  │          │
│           │  │           │  │          │  │          │
│ 1-2 周    │  │ 2-3 周    │  │ 3-4 周   │  │ 4-6 周   │
└───────────┘  └───────────┘  └──────────┘  └──────────┘
```

**建议立即开始的 3 件事：**
1. e2e 测试隔离数据库（防止数据持续污染）
2. Provider 健康监控 + admin 面板（没有可观测性就没有可靠性）
3. 多轮对话上下文管理（当前 chat 体验的最大短板）
