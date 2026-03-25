# Admin 面板增强方案

## Context

当前 admin 面板覆盖了基础功能（用户管理、offering 审核、邀请、使用量统计、设置、通知），但缺少生产运营所需的关键功能。

## 现状

| 功能 | 前端 | 后端 | 状态 |
|------|------|------|------|
| 用户管理 | ✅ | ✅ | 完整 |
| Offering 审核 | ✅ | ✅ | 完整 |
| 邀请管理 | ✅ | ✅ | 完整 |
| 使用量统计 | ✅ | ✅ | 完整 |
| 设置/配置 | ✅ | ✅ | 完整 |
| 通知管理 | ✅ | ✅ | 完整 |
| Provider 列表 | ✅ | ✅ | 基础 |
| **请求明细** | ❌ | 部分 | **缺 UI** |
| **审计日志** | ❌ | ✅ | **缺 UI** |
| **结算/财务** | ❌ | ❌ | **全缺** |
| **Offering 编辑** | ❌ | 部分 | **缺编辑/删除** |
| **Provider 凭证管理** | ❌ | ❌ | **全缺** |
| **系统健康** | 部分 | ❌ | **不完整** |

## 优先级排序

### P0 — 运营必须

#### 1. 请求明细日志页
- 展示 `api_requests` 表完整数据
- 字段：requestId、时间、用户、模型、provider、offering、input/output tokens、status、延迟
- 筛选：按模型、provider、用户、日期范围、状态
- 分页（每页 50 条）
- 后端：`GET /v1/admin/requests?model=&user=&days=&page=&limit=`
- 前端：新页面 `AdminRequestsPage.tsx`

#### 2. 结算/财务面板
- 展示 `settlement_records` 数据
- 总览卡片：总收入、总支出（供应商分成）、平台利润、结算笔数
- 明细表：requestId、消费者、供应商、消费者扣费、供应商收益、平台利润、时间
- 筛选：日期范围、供应商、消费者
- 后端：`GET /v1/admin/settlements?days=&supplier=&consumer=&page=`
- 前端：新页面 `AdminSettlementsPage.tsx`

#### 3. 审计日志 UI
- 展示 `audit_logs` 表数据（后端 endpoint 已存在）
- 字段：时间、操作者、动作、目标类型、目标 ID、详情
- 筛选：按动作类型、操作者、日期
- 前端：新页面 `AdminAuditPage.tsx`

### P1 — 管理控制

#### 4. Offering 管理（编辑/删除）
- 从审核页扩展：admin 可编辑已上线 offering 的参数
- 可编辑字段：pricing（in/out）、enabled、context_length、daily_token_limit、max_concurrency
- 可删除/归档 offering
- 后端：`PATCH /v1/admin/offerings/{id}` + `DELETE /v1/admin/offerings/{id}`
- 前端：在 ReviewsPage 增加"已上线"tab，或新建 `AdminOfferingsPage.tsx`

#### 5. Provider 凭证管理
- 查看所有 provider_credentials：类型、base_url、anthropic_base_url、状态、关联 offering 数
- 编辑 base_url / anthropic_base_url
- 启用/禁用 credential
- 后端：`GET/PATCH /v1/admin/credentials`
- 前端：增强 ProvidersPage

#### 6. 系统健康面板
- Provider 错误率（从 circuit breaker 状态获取）
- 请求延迟 P95/P99
- 活跃节点数量和状态
- 后端：`GET /v1/admin/health`（聚合 metrics）

### P2 — 后续增强

- 7. 用户钱包交易记录（ledger_entries 查询）
- 8. 用户内容审核（评论管理）
- 9. 批量操作（批量审核、批量禁用用户）
- 10. 限流策略管理 UI

## 实施建议

**第一批**（P0）：请求明细 + 结算面板 + 审计日志 UI — 约 3 个新页面 + 3 个新 API 端点
**第二批**（P1）：Offering 编辑 + Provider 凭证 + 系统健康 — 约 2 个新页面 + 增强 3 个现有页面

## 文件清单（第一批）

| 文件 | 改动 |
|------|------|
| `routes/admin.ts` | 新增 requests、settlements 端点 |
| `repositories/postgres-platform-repository.ts` | 新增查询方法 |
| `repositories/platform-repository.ts` | 接口声明 |
| `pages/admin/AdminRequestsPage.tsx` | **新建** |
| `pages/admin/AdminSettlementsPage.tsx` | **新建** |
| `pages/admin/AdminAuditPage.tsx` | **新建** |
| `components/layout/AdminLayout.tsx` | 添加导航链接 |
| `App.tsx` | 注册路由 |
| `lib/i18n.ts` | 添加国际化文本 |

## Verification

1. `npm run build` 通过
2. admin 面板新页面正常加载
3. 请求明细支持筛选和分页
4. 结算数据与 DB 一致
5. 审计日志显示正确
