# 管理面板优化

> 日期: 2026-03-31
> 状态: todo

## 概述

对管理面板四个核心页面进行优化：通知管理、供应商变更记录、节点状态、用户管理。

---

## 一、通知管理优化

### 1.1 已发通知分页

**现状：** `GET /v1/admin/notifications` 一次返回全部通知，前端无分页。

**方案：**
- 后端：`listAdminNotifications` 增加 `page` + `limit` 参数，返回 `{ data, total }`
- 前端：复用已有分页 UI 模式，每页 20 条

**API 变更：**
```
GET /v1/admin/notifications?page=1&limit=20
Response: { data: Notification[], total: number }
```

### 1.2 个人通知同步邮件

**现状：** `type=personal` 通知仅站内推送，无邮件选项。

**方案：**
- 前端：当 `type=personal` 时，显示「同步发送邮件」checkbox
- 后端：`POST /v1/admin/notifications` 新增 `sendEmail?: boolean` 字段
- 收到 `sendEmail=true` 时，查找目标用户邮箱，调用 `sendTransactionalEmail` 发送
- 新增邮件模板 `admin_notification`

**邮件模板：**
```
subject: "[xllmapi] {title}"
body:
  你好 {displayName}，

  {content}

  —— xllmapi 平台通知
```

---

## 二、供应商变更记录优化

### 2.1 变更记录分页

**现状：** `PresetAuditLog` 硬编码 `limit=20`，无分页。

**方案：**
- 后端：`GET /v1/admin/provider-presets/audit-log` 增加 `page` 参数，返回 `{ data, total }`
- 前端：添加分页控件，每页 15 条

**API 变更：**
```
GET /v1/admin/provider-presets/audit-log?page=1&limit=15
Response: { data: AuditEntry[], total: number }
```

### 2.2 变更详情展开

**现状：** audit_logs 的 `payload` JSONB 已存储变更信息，但只显示 label + baseUrl。

**方案：**
- 后端：`upsertProviderPreset` 写 audit log 时，将 `oldValue` 和 `newValue` 完整存入 payload
  ```jsonc
  {
    "changes": {
      "label": { "old": "OpenAI(no-official)", "new": "OpenAI-AH(no-official)" },
      "baseUrl": { "old": "https://api.aixhan.com", "new": "https://api.hanbbq.top/v1" }
    }
  }
  ```
- 前端：每行增加展开按钮，点击显示变更字段对比（old → new），用红/绿色标记

---

## 三、节点状态优化

### 3.1 完整节点状态模型

**场景分析：**

| 场景 | 触发者 | 是否可恢复 | 谁能恢复 |
|------|--------|-----------|---------|
| 正常运行 | - | - | - |
| 供应者主动停止 | owner | 是 | owner |
| 管理员停止（临时） | admin | 是 | admin |
| 管理员禁用（封禁） | admin | 是，但 owner 无权 | admin only |
| 熔断器自动停止 | system | 自动恢复/admin 重置 | system/admin |
| 凭证失效（用户删了 Key） | owner (间接) | 否 | 不可恢复 |

**DB 设计：**
```sql
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS disabled_by TEXT
  CHECK (disabled_by IN ('admin_stop', 'admin_ban', 'owner', 'auto'));
-- admin_stop: 管理员临时停止（可恢复）
-- admin_ban:  管理员禁用/封禁（owner 不可恢复）
-- owner:      供应者自己停止
-- auto:       熔断器自动禁用
-- NULL:       正常运行
```

**状态判定逻辑（优先级从高到低）：**
1. credential 不存在 / 已删除 → `orphaned`（已失效）
2. `disabled_by = 'admin_ban'` → `banned`（已禁用）
3. `disabled_by = 'admin_stop'` → `admin_stopped`（管理员停止）
4. `disabled_by = 'auto'` → `auto_stopped`（自动停止）
5. `disabled_by = 'owner'` → `stopped`（已停止）
6. `enabled = false`（兼容旧数据）→ `stopped`
7. breaker open/half-open → `unhealthy`（异常）
8. breaker closed → `healthy`（正常）

**前端 Badge 映射：**

| 状态 | Badge | 颜色 |
|------|-------|------|
| healthy | 正常 | 绿色 |
| stopped | 已停止 | 灰色 |
| admin_stopped | 管理员停止 | 蓝色 |
| banned | 已禁用 | 红色 |
| auto_stopped | 自动停止 | 橙色 |
| orphaned | 已失效 | 暗红/灰 |
| unhealthy | 异常 | 黄色 |

**Tab 分类：**
- 全部 / 正常 / 已停止(含 stopped + admin_stopped + auto_stopped) / 已禁用 / 已失效 / 异常

**管理员操作按钮：**

| 当前状态 | 可用操作 |
|---------|---------|
| healthy | 停止、禁用 |
| stopped (owner) | 启动、禁用 |
| admin_stopped | 启动、禁用 |
| banned | 解除禁用 |
| auto_stopped | 重置熔断器、禁用 |
| orphaned | 删除节点 |
| unhealthy | 停止、禁用、重置熔断器 |

**后端 SQL：**
```sql
SELECT o.*,
  CASE
    WHEN c.id IS NULL THEN 'orphaned'
    WHEN o.disabled_by = 'admin_ban' THEN 'banned'
    WHEN o.disabled_by = 'admin_stop' THEN 'admin_stopped'
    WHEN o.disabled_by = 'auto' THEN 'auto_stopped'
    WHEN o.disabled_by = 'owner' THEN 'stopped'
    WHEN o.enabled = false THEN 'stopped'
    ELSE 'active'
  END AS "nodeStatus"
FROM offerings o
LEFT JOIN provider_credentials c ON c.id = o.credential_id
...
```

### 3.2 节点详情面板增强

**延迟追踪 — DB 迁移：**
```sql
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_total_ms INTEGER;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_ttfb_ms INTEGER;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_queue_ms INTEGER;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_upstream_ms INTEGER;
```

**后端：** 请求执行器（provider-executor）在请求完成时记录各环节耗时。

**新增 API：**
```
GET /v1/admin/offering-health/:id/stats
Response: {
  avgLatency: { total, ttfb, queue, upstream },  // 最近10次平均
  totalRequests: number,
  totalInputTokens: number,
  totalOutputTokens: number,
  successRate: number,
  todayRequests: number,
  todayInputTokens: number,
  todayOutputTokens: number,
  todaySuccessRate: number,
  recentRequests: [{ id, status, totalMs, ttfbMs, tokens, createdAt }]
}
```

**前端详情面板新增：**
- 延迟概览（最近10次平均）+ 可视化条形图（排队 → TTFB → 上游处理）
- 使用统计（总计 + 当日）
- 最近请求列表

---

## 四、用户管理优化

### 4.1 可展开行替代横向滚动

**现状：** 每行 9 列，列太多导致横向滚动。

**方案：**
- 表格主行只保留核心列：邮箱、昵称、角色、余额、状态
- 点击行展开详情面板，显示完整信息
- 详情含：handle、注册时间、最后登录、IP、节点数、请求数、token 使用、当日统计

**后端：** `GET /v1/admin/users` 响应增加字段：
```typescript
interface AdminUser {
  // ...existing
  offeringCount: number;
  totalRequests: number;
  totalTokens: number;
  todayRequests: number;
  todayTokens: number;
}
```

### 4.2 高风险操作确认对话框 + 5s 冷却

**现状：** 使用 `window.prompt` 或无确认直接执行。

**方案：** 新建 `ConfirmDialog` 组件：
- 确认按钮初始 disabled，5 秒倒计时后才可点击
- 按钮显示剩余秒数：`确认 (5s)` → `确认 (4s)` → ... → `确认`
- 调整余额时，对话框内含金额输入框
- 3 种操作各有不同的警告文案和颜色：
  - 设为管理员 → 橙色警告
  - 禁用/启用 → 红色警告
  - 调整余额 → 橙色警告 + 输入框

---

## 五、数据库迁移

新增 `infra/sql/postgres/018_admin_panel_enhancements.sql`：

```sql
-- 1. 节点停用来源
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS disabled_by TEXT
  CHECK (disabled_by IN ('admin_stop', 'admin_ban', 'owner', 'auto'));

-- 2. 延迟追踪
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_total_ms INTEGER;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_ttfb_ms INTEGER;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_queue_ms INTEGER;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_upstream_ms INTEGER;

-- 3. 索引
CREATE INDEX IF NOT EXISTS idx_api_requests_offering_recent
  ON api_requests (chosen_offering_id, created_at DESC)
  WHERE status IS NOT NULL;
```

---

## 六、文件变更清单

| 文件 | 变更 |
|------|------|
| `infra/sql/postgres/018_admin_panel_enhancements.sql` | 新增迁移 |
| `apps/platform-api/src/routes/admin.ts` | 通知分页、audit-log 分页、offering stats/actions API、用户统计 |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | 新增查询方法 |
| `apps/platform-api/src/core/provider-executor.ts` | 记录延迟数据 |
| `apps/platform-api/src/email.ts` | 新增 admin_notification 模板 |
| `apps/web/src/pages/admin/AdminNotificationsPage.tsx` | 分页 + 邮件选项 |
| `apps/web/src/pages/admin/ProvidersPage.tsx` | audit log 分页 + 展开详情 |
| `apps/web/src/pages/admin/AdminNodeHealthPage.tsx` | 完整状态模型 + stats 面板 |
| `apps/web/src/pages/admin/UsersPage.tsx` | 可展开行 + 统计数据 |
| `apps/web/src/components/ui/ConfirmDialog.tsx` | 新建 5s 冷却确认对话框 |
| `apps/web/src/locales/*.json` | 新增 i18n 键 |

---

## 七、实施顺序

**P1（并行）：**
- A: DB 迁移 + 后端延迟记录（provider-executor 改造）
- B: ConfirmDialog 通用组件
- C: 通知分页（前后端）+ 邮件模板

**P2（并行，P1-A 完成后）：**
- D: 节点状态完整模型（前后端）
- E: 用户管理可展开行 + 统计
- F: audit log 分页 + 变更详情展开

**P3：**
- 整体 e2e 测试 + 本地模拟验证

---

## 八、本地模拟测试项

- [ ] 通知分页：发送 25+ 通知后翻页
- [ ] 个人通知邮件：dev 模式下确认 mock email 发出
- [ ] 供应商 audit log 翻页 + 展开查看变更详情
- [ ] 节点状态：各状态 Badge 显示正确
- [ ] 管理员停止/禁用/解除禁用操作
- [ ] 凭证删除后节点显示「已失效」
- [ ] 节点详情面板：延迟数据、token 统计、当日数据
- [ ] 用户列表可展开行，无横向滚动
- [ ] 设为管理员/禁用/调整余额的 5s 冷却确认框
- [ ] 确认框倒计时到 0 才可点击确认
