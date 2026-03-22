# Phase 2 实施计划 — 完整任务拆解

> 参考 OpenRouter 公开页面模式：使用量驱动排名、无需登录的模型浏览/排行/详情、时间序列面积图、多维排序。

---

## Sprint 1：多轮对话核心（3 天）

### Task 1.1 — 后端：对话 stream 支持多轮上下文
**文件**：`apps/platform-api/src/main.ts` (conversation stream handler)
- [ ] 加载 conversation 的历史 messages（从 DB）
- [ ] 实现 token 估算函数：`estimateTokens(text) = Math.ceil(text.length / 3.5)`
- [ ] 实现上下文窗口裁剪：保留 system prompt → 从最新往回取 → 不超过模型限制的 80%
- [ ] 拼装完整 `messages[]` 传给 `executeStreamingRequest()`
- [ ] 确保 settlement 按实际 provider 返回的 usage 结算（不变）

### Task 1.2 — 后端：conversation 表增加 system_prompt
**文件**：`infra/sql/postgres/`, `apps/platform-api/src/db.ts`, repositories
- [ ] PostgreSQL migration：`ALTER TABLE chat_conversations ADD COLUMN system_prompt TEXT DEFAULT ''`
- [ ] SQLite schema 同步
- [ ] `createChatConversation` 支持 `systemPrompt` 参数
- [ ] `updateChatConversation` 支持修改 `systemPrompt`
- [ ] API：`PATCH /v1/chat/conversations/{id}` 增加 `systemPrompt` 字段

### Task 1.3 — 前端：Chat 设置面板
**文件**：`apps/web/src/pages/chat/`
- [ ] 对话头部增加设置按钮（齿轮图标）
- [ ] 点击弹出面板：system prompt 文本框 + 保存
- [ ] 输入框上方显示上下文 token 估算值（灰色小字）
- [ ] useChatStore 支持 systemPrompt 字段的读写

### Task 1.4 — 后端：模型上下文窗口配置
**文件**：`apps/platform-api/src/services/platform-service.ts`
- [ ] 定义 `MODEL_CONTEXT_LIMITS` map：每个 logicalModel → maxTokens
- [ ] 默认值：128K（deepseek）, 128K（gpt-4o）, 200K（claude）, 200K（minimax）
- [ ] provider-executor 裁剪时查询此 map

---

## Sprint 2：对话搜索 + 缓存（2 天）

### Task 2.1 — 后端：对话搜索 API
**文件**：`apps/platform-api/src/main.ts`, repositories
- [ ] `GET /v1/chat/conversations/search?q={keyword}&limit=20`
- [ ] PostgreSQL：`WHERE title ILIKE '%kw%' OR EXISTS (SELECT 1 FROM chat_messages WHERE content ILIKE '%kw%' AND conversation_id = c.id)`
- [ ] 返回 `{conversations: [{id, title, matchSnippet, matchedAt}]}`
- [ ] snippet 提取：匹配关键词前后各 50 字

### Task 2.2 — 前端：侧栏搜索
**文件**：`apps/web/src/pages/chat/components/ChatSidebar.tsx`
- [ ] 侧栏顶部增加搜索输入框
- [ ] debounce 300ms 调用搜索 API
- [ ] 搜索结果列表：标题 + 匹配片段（关键词 `<mark>` 高亮）
- [ ] 点击结果跳转对应对话
- [ ] 空搜索时恢复显示正常对话列表

### Task 2.3 — 前端：对话本地缓存（可选，低优先）
**文件**：`apps/web/src/pages/chat/hooks/useChatStore.ts`
- [ ] 引入 `idb-keyval`
- [ ] 切换对话时 cache-first：先读 IndexedDB → 显示 → 异步 sync → 增量更新
- [ ] 流式完成后写入 IndexedDB

---

## Sprint 3：公共模型排行榜（3 天）

> 参考 OpenRouter `/rankings` 和 `/models` — 无需登录，usage-driven ranking。

### Task 3.1 — 后端：模型性能统计 API（公开，无需登录）
**文件**：`apps/platform-api/src/main.ts`, repositories
- [ ] `GET /v1/network/models/stats`（公开端点）
- [ ] SQL 从 `settlement_records` 聚合（最近 30 天）：
  ```sql
  SELECT logical_model,
    COUNT(*) as total_requests,
    AVG(total_ms) as avg_latency_ms,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_ms) as p50,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_ms) as p95,
    COUNT(*) FILTER (WHERE status = 'success') * 100.0 / COUNT(*) as success_rate,
    SUM(total_tokens) as total_tokens
  FROM settlement_records
  WHERE created_at > NOW() - INTERVAL '30 days'
  GROUP BY logical_model
  ```
- [ ] 返回每个模型：totalRequests, avgLatencyMs, p50/p95, successRate, totalTokens, last7dTrend[]

### Task 3.2 — 后端：模型使用趋势 API（公开）
**文件**：`apps/platform-api/src/main.ts`
- [ ] `GET /v1/network/models/trend?days=30`（公开端点）
- [ ] 返回每日每模型的 token 消耗量（面积图数据源）
  ```json
  {"data": [{"date": "2026-03-22", "models": {"deepseek-chat": 45000, "MiniMax-M2.7": 12000}}]}
  ```

### Task 3.3 — 前端：模型网络页重构
**文件**：`apps/web/src/pages/ModelsPage.tsx`
- [ ] 安装 `recharts`：`npm install recharts`
- [ ] 页面顶部：全网统计卡片（总 Token 处理量、活跃模型数、活跃用户数、总请求数）
- [ ] 排序控件栏：使用量 / 延迟 / 成功率 / 价格（参考 OpenRouter 7 种排序）
- [ ] 搜索框：按模型名搜索
- [ ] 模型卡片增强：
  - 性能指标行（请求数、平均延迟、成功率）
  - 7 天 sparkline（迷你折线图）
  - 使用热度进度条
  - 价格显示：input/output per 1K tokens
- [ ] 页面顶部增加 token 消耗趋势面积图（参考 OpenRouter Rankings "Top Models" 图）

### Task 3.4 — 前端：模型详情页
**文件**：新建 `apps/web/src/pages/ModelDetailPage.tsx`
- [ ] 路由：`/models/:logicalModel`
- [ ] 头部：模型名 + 状态 + API ID（可复制）
- [ ] 规格区：上下文长度、支持能力、价格（input/output）
- [ ] 性能图表：延迟趋势（P50/P95，最近 7 天折线图）
- [ ] 供应商列表：谁在提供此模型（handle、在线时长）
- [ ] 最近使用量趋势（面积图，最近 30 天）
- [ ] App.tsx 增加路由

---

## Sprint 4：用户控制台可视化（2 天）

### Task 4.1 — 后端：用户级趋势 + 分布 API
**文件**：`apps/platform-api/src/main.ts`, db.ts, repositories
- [ ] `GET /v1/usage/consumption/trend?days=30`（需登录）
  - 返回每日 inputTokens, outputTokens, requestCount
- [ ] `GET /v1/usage/consumption/breakdown`（需登录）
  - 返回按模型聚合的 token 占比
- [ ] `GET /v1/usage/consumption/latency-distribution`（需登录）
  - 返回延迟分布桶：[<1s, 1-3s, 3-5s, >5s] 各多少请求

### Task 4.2 — 前端：Overview 图表区
**文件**：`apps/web/src/pages/app/OverviewPage.tsx`
- [ ] Stat 卡片增强：今日消耗 vs 昨日（箭头+百分比）、今日请求数、活跃模型数
- [ ] Token 消耗趋势折线图（recharts LineChart，双线 input/output，30 天）
- [ ] 模型使用占比环形图（recharts PieChart）
- [ ] 请求延迟分布柱状图（recharts BarChart）
- [ ] 图表统一深色主题样式（accent 色系）

### Task 4.3 — 前端：用户模型详情跳转
**文件**：`apps/web/src/pages/app/OverviewPage.tsx`
- [ ] 模型占比环形图点击 → 过滤热力图 + 明细表到该模型
- [ ] 明细表模型名可点击 → 跳转公开模型详情页 `/models/:logicalModel`

---

## Sprint 5：Admin 监控面板（2 天）

### Task 5.1 — 后端：Admin 趋势 + 健康 API
**文件**：`apps/platform-api/src/main.ts`, repositories
- [ ] `GET /v1/admin/usage/trend?days=30`（admin only）
  - 系统级每日 requests + tokens（折线/面积图）
- [ ] `GET /v1/admin/usage/provider-health`（admin only）
  - 每个 providerType 的成功率、平均延迟、当前熔断状态
  - 数据源：settlement_records + circuit-breaker 内存状态
- [ ] `GET /v1/admin/usage/recent?limit=50`（admin only）
  - 最近 50 条请求：时间、用户、模型、延迟、状态、token 数

### Task 5.2 — 前端：Admin Overview 重构
**文件**：`apps/web/src/pages/admin/AdminOverviewPage.tsx`
- [ ] 5 个 stat 卡片：用户数、活跃用户、总请求、总 Token、待审核
- [ ] 请求量+Token 双轴趋势图（recharts，30 天面积图）
- [ ] 模型使用排名条形图（top 10）
- [ ] Provider 健康状态卡片：每个 provider 显示成功率 + 色标（绿/黄/红）
- [ ] 最近请求实时流表格（50 条，每 30s 自动刷新）

### Task 5.3 — 前端：Admin Usage 页增强
**文件**：`apps/web/src/pages/admin/UsagePage.tsx`
- [ ] 按时间范围切换（7d / 30d / 90d）
- [ ] 模型使用趋势面积图（堆叠，参考 OpenRouter Rankings 图）
- [ ] 用户使用量排名表（top consumers）

---

## Sprint 6：公共排行榜页（2 天）

> 参考 OpenRouter `/rankings` — 独立公开页面展示平台数据。

### Task 6.1 — 后端：排行榜聚合 API（公开）
**文件**：`apps/platform-api/src/main.ts`
- [ ] `GET /v1/network/rankings`（公开，无需登录）
  - 返回：topModels（按 token 使用量排名 top 20）
  - 每个模型：logicalModel, weeklyTokens, weeklyRequests, weeklyGrowthPct
  - market share：每个 provider 的 token 占比趋势（最近 12 周）

### Task 6.2 — 前端：Rankings 公开页
**文件**：新建 `apps/web/src/pages/RankingsPage.tsx`
- [ ] 路由：`/rankings`（无需登录，公开展示）
- [ ] 顶部 hero：全网统计数字（总 Token、用户数、模型数、provider 数）
- [ ] Top Models 堆叠面积图（最近 12 周，每周 token 使用量，参考 OpenRouter）
- [ ] 模型排行榜表格：排名、模型名、周使用量、周增长 %、价格
- [ ] Market Share 堆叠面积图（按 provider 维度：DeepSeek / MiniMax / OpenAI / ...）
- [ ] App.tsx 增加路由，Header nav 增加 "排行" 链接

---

## Sprint 7：前端全局优化（2 天）

### Task 7.1 — Skeleton 加载态
**文件**：新建 `apps/web/src/components/ui/Skeleton.tsx`
- [ ] 通用 Skeleton 组件（矩形闪烁）
- [ ] 替换所有页面的 "Loading…" 文字：
  - ModelsPage: 模型卡片骨架
  - OverviewPage: 卡片+图表骨架
  - NetworkPage: 表单+listing 骨架
  - ChatPage: 消息列表骨架

### Task 7.2 — 响应式布局
**文件**：多个页面组件
- [ ] DashboardLayout 侧栏：移动端折叠为顶部 tab bar 或汉堡菜单
- [ ] ChatPage：移动端侧栏为抽屉（点击汉堡展开/收起）
- [ ] ModelsPage/RankingsPage：移动端卡片单列，图表横向滚动
- [ ] 所有 stat card grid：`grid-cols-2 md:grid-cols-4`

### Task 7.3 — 图表主题一致性
**文件**：新建 `apps/web/src/lib/chart-theme.ts`
- [ ] 定义统一图表颜色 palette（与 CSS 变量对应）
- [ ] recharts 自定义 tooltip 样式（深色背景、圆角、accent 色）
- [ ] 统一 axis、grid、legend 样式

### Task 7.4 — 键盘快捷键
**文件**：`apps/web/src/App.tsx` 或新建 hook
- [ ] `Cmd/Ctrl+K`：全局搜索（跳到 chat 搜索或模型搜索）
- [ ] Chat 输入框 `Ctrl+Enter` 发送（已有）
- [ ] `Esc`：关闭弹窗

---

## Sprint 8：Homepage 改版 + 收尾（2 天）

### Task 8.1 — Homepage 数据展示
**文件**：`apps/web/src/pages/HomePage.tsx`
- [ ] Hero 区增加全网统计数字（参考 OpenRouter：总 Token、用户数、模型数、provider 数）
- [ ] Featured Models：按周使用量 top 3，每张卡片显示模型名、provider、周 token 量、周增长 %
- [ ] Provider 图标栏（支持的厂商 logo）
- [ ] "Explore Models →" CTA 链接到 `/models`
- [ ] "View Rankings →" CTA 链接到 `/rankings`

### Task 8.2 — 后端：全网公开统计 API
**文件**：`apps/platform-api/src/main.ts`
- [ ] `GET /v1/network/stats`（公开）
  - 返回：totalTokensProcessed, activeUsers, modelCount, providerCount, featuredModels[]

### Task 8.3 — 收尾：全流程测试 + 文档
- [ ] 所有新页面的 i18n（中/英）
- [ ] 所有新 API 端点的 e2e 测试覆盖
- [ ] 更新 .agents/docs/v0.0.3/ changelog + architecture
- [ ] 更新 README.md 项目结构

---

## 总览 Gantt

```
Sprint 1 ███░░░░░░░░░░░░░░░  多轮对话核心           Day 1-3
Sprint 2 ░░░██░░░░░░░░░░░░░  对话搜索+缓存          Day 4-5
Sprint 3 ░░░░░███░░░░░░░░░░  公共模型排行榜          Day 6-8
Sprint 4 ░░░░░░░░██░░░░░░░░  用户控制台图表          Day 9-10
Sprint 5 ░░░░░░░░░░██░░░░░░  Admin 监控面板          Day 11-12
Sprint 6 ░░░░░░░░░░░░██░░░░  公共排行榜页            Day 13-14
Sprint 7 ░░░░░░░░░░░░░░██░░  前端全局优化            Day 15-16
Sprint 8 ░░░░░░░░░░░░░░░░██  Homepage+收尾           Day 17-18
```

**总工期：18 个工作日（约 3.5 周）**

---

## 新增依赖清单

```
前端：
  recharts             # 图表（折线、面积、饼、柱）
  idb-keyval           # IndexedDB 封装（Sprint 2.3，可选）

后端：
  无新依赖

数据库：
  ALTER TABLE chat_conversations ADD COLUMN system_prompt TEXT DEFAULT '';
  -- 无新表，所有统计从 settlement_records 聚合
```

## 新增路由清单

```
公开（无需登录）：
  GET  /v1/network/stats              # 全网统计
  GET  /v1/network/models/stats       # 模型性能统计
  GET  /v1/network/models/trend       # 模型使用趋势
  GET  /v1/network/rankings           # 排行榜数据

用户（需登录）：
  GET  /v1/usage/consumption/trend    # 用户消耗趋势
  GET  /v1/usage/consumption/breakdown # 模型占比
  GET  /v1/usage/consumption/latency-distribution # 延迟分布
  GET  /v1/chat/conversations/search  # 对话搜索
  PATCH /v1/chat/conversations/:id    # 更新 system prompt

Admin（需 admin）：
  GET  /v1/admin/usage/trend          # 系统级趋势
  GET  /v1/admin/usage/provider-health # Provider 健康
  GET  /v1/admin/usage/recent         # 最近请求流

前端页面：
  /models/:logicalModel               # 模型详情页
  /rankings                           # 公开排行榜
```

## 每个 Sprint 的验收标准

| Sprint | 验收标准 |
|--------|---------|
| 1 | Chat 对话可多轮，provider 收到完整历史，可设置 system prompt |
| 2 | 侧栏搜索框能搜到历史对话+消息内容 |
| 3 | `/models` 页面有排序、性能指标、sparkline；`/models/:id` 详情页可访问 |
| 4 | 用户 Overview 有趋势折线图 + 环形占比图 + 延迟分布柱状图 |
| 5 | Admin 面板有趋势图 + provider 健康色标 + 实时请求流 |
| 6 | `/rankings` 公开页有面积图 + 排行表 + market share 图 |
| 7 | 所有页面有 skeleton 加载，移动端可用，图表风格统一 |
| 8 | Homepage 有全网统计 + featured models，所有 i18n 完成 |
