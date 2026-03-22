# Admin 管理界面设计优化方案

## Context

当前 Admin 面板极其简陋：5 个页面共 525 行，只有基础数据展示，无搜索/筛选/操作/趋势图。同时存在 3 个前后端数据字段不匹配的 bug。需要全面提升到生产级管理面板。

## 现状问题

| 页面 | 当前功能 | 缺失 |
|------|---------|------|
| Overview | 4 个数字卡片 | 趋势图、系统健康、最近活动 |
| Users | 纯表格（无操作） | 搜索、状态管理、余额查看、活跃度 |
| Invitations | 发送+列表 | 撤销、重发、过期提示、批量操作 |
| Reviews | 审核列表 | 用户信息缺失、拒绝原因、详情预览 |
| Usage | 3 数字 + top10 表 | 时间筛选、趋势图、per-user 分析 |

**数据字段 bug**：
- Invitations: 前端读 `email`/`invitedBy`，后端返回 `invitedEmail`/`inviterDisplayName`
- Reviews: 前端读 `userId`，后端返回 `ownerUserId`，且无用户 email
- Users: `lastLoginAt` 已返回但未显示

---

## Step 1: Admin Overview 重构

**文件**: `apps/web/src/pages/admin/AdminOverviewPage.tsx`

```
┌──────────────────────────────────────────────────────────┐
│  Admin Dashboard                                          │
│                                                           │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐     │
│  │ 52    │ │ 8     │ │ 25    │ │ 3     │ │ 0     │     │
│  │ 用户   │ │ 活跃   │ │ 请求   │ │ 模型   │ │ 待审   │     │
│  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘     │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  系统趋势 (7d/30d)         [请求量] [Token] [用户]   │ │
│  │  (复用 ModelsPage 的 TrendChart 组件)                │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────┐ ┌───────────────────────────┐  │
│  │  最近请求 (实时)      │ │  Provider 健康              │  │
│  │  14:23 ccc ds 1.2s  │ │  🟢 DeepSeek  99%         │  │
│  │  14:22 bbb mm 2.1s  │ │  🟢 MiniMax   95%         │  │
│  │  14:21 aaa ds 0.9s  │ │                            │  │
│  └─────────────────────┘ └───────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**改动**：
- 5 个 stat 卡片（用户数、活跃用户、总请求、模型数、待审核）
- 系统趋势图：复用 `TrendChart` 组件，用 `/v1/network/trends` 数据
- 最近请求列表：新增 `GET /v1/admin/usage/recent?limit=20` 端点
- Provider 健康状态：从 circuit-breaker 内存状态读取

**后端新增**：
- `GET /v1/admin/usage/recent` → 最近 N 条请求（含用户名、模型、状态）
- `GET /v1/admin/stats` → 活跃用户数（7 天内有请求的）

---

## Step 2: Users 页面增强

**文件**: `apps/web/src/pages/admin/UsersPage.tsx`

```
┌──────────────────────────────────────────────────────────┐
│  用户管理                              🔍 搜索用户...     │
│                                                           │
│  [全部] [活跃] [管理员]                                    │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Email        │ 昵称   │ 角色  │ 余额    │ 最近登录 │  │
│  │ ccc@ccc.com  │ ccc   │ user  │ 998K   │ 3/22    │  │
│  │ bbb@bbb.com  │ bbb   │ user  │ 1.0M   │ 3/22    │  │
│  │ admin@...    │ test  │ admin │ 1.0M   │ 3/22    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  显示 1-5 / 52   [上一页] [下一页]                        │
└──────────────────────────────────────────────────────────┘
```

**改动**：
- 搜索框（按 email / displayName 模糊搜索）
- 角色筛选 tab（全部/活跃/管理员）
- 增加列：余额（xtokens）、最近登录时间、状态
- 后端：`GET /v1/admin/users` 增加 `?q=keyword&role=admin` 查询参数
- 后端：返回用户余额（LEFT JOIN wallets）

---

## Step 3: Invitations 数据修复 + 增强

**文件**: `apps/web/src/pages/admin/AdminInvitationsPage.tsx`

**Bug 修复**（前后端字段对齐）：
- `email` → 读 `invitedEmail`
- `invitedBy` → 读 `inviterDisplayName`

**功能增强**：
- 状态颜色标识：pending=黄, accepted=绿, expired=灰
- 过期提示（`expiresAt` 已返回但未使用）
- 撤销按钮：调用 `POST /v1/invitations/{id}/revoke`（已有端点）

---

## Step 4: Reviews 数据修复 + 增强

**文件**: `apps/web/src/pages/admin/ReviewsPage.tsx`

**Bug 修复**：
- `userId` → 读 `ownerUserId`
- 后端 `listPendingOfferings` JOIN 用户表获取 email + displayName

**功能增强**：
- 显示用户邮箱 + 昵称（不再只有 userId）
- 显示定价信息（已返回但未展示）
- 显示 provider 类型 + baseUrl
- 拒绝时弹框输入原因

---

## Step 5: Usage 页面增强

**文件**: `apps/web/src/pages/admin/UsagePage.tsx`

```
┌──────────────────────────────────────────────────────────┐
│  使用统计                              [7d] [30d] [全部]  │
│                                                           │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐               │
│  │ 25    │ │ 6.1K  │ │ 5     │ │ 3     │               │
│  │ 请求   │ │ Token │ │ 用户   │ │ 模型   │               │
│  └───────┘ └───────┘ └───────┘ └───────┘               │
│                                                           │
│  模型排名                                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 模型           │ 请求数  │ Token    │ 用户数 │ 占比  │  │
│  │ deepseek-chat  │ 21     │ 908     │ 3     │ 84%  │  │
│  │ MiniMax-M2.7   │ 3      │ 882     │ 1     │ 12%  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  Top 用户                                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 用户        │ 请求数  │ Token     │ 消费 xtokens    │  │
│  │ ccc@ccc.com │ 18     │ 4.5K     │ 2.3K           │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**改动**：
- 时间范围筛选（7d/30d/全部）
- 增加用户数、模型数卡片
- 模型表增加用户数列 + 占比条
- 新增 Top 用户表
- 后端：`GET /v1/admin/usage` 增加 `?days=7` 时间筛选参数
- 后端：返回 `topConsumers` 数据

---

## Step 6: AdminLayout 移动端适配

**文件**: `apps/web/src/components/layout/AdminLayout.tsx`

与 DashboardLayout 一致的改法：
- 桌面端：侧栏 180px
- 移动端：隐藏侧栏，改为顶部 tab bar

---

## 文件清单

| 文件 | 操作 |
|------|------|
| `apps/web/src/pages/admin/AdminOverviewPage.tsx` | 重写：趋势图 + 最近请求 + Provider 健康 |
| `apps/web/src/pages/admin/UsersPage.tsx` | 重写：搜索 + 筛选 + 余额 + 最近登录 |
| `apps/web/src/pages/admin/AdminInvitationsPage.tsx` | 修复字段 + 状态颜色 + 撤销 |
| `apps/web/src/pages/admin/ReviewsPage.tsx` | 修复字段 + 用户信息 + 定价展示 |
| `apps/web/src/pages/admin/UsagePage.tsx` | 重写：时间筛选 + Top 用户 |
| `apps/web/src/components/layout/AdminLayout.tsx` | 移动端 tab bar |
| `apps/platform-api/src/routes/admin.ts` | 新增端点 + 修复查询 |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | 修复查询 + 新增方法 |
| `apps/web/src/lib/i18n.ts` | Admin 相关 i18n keys |

---

## Step 7: 用户管理操作

**文件**: `apps/web/src/pages/admin/UsersPage.tsx`, `apps/platform-api/src/routes/admin.ts`

用户列表每行增加操作按钮：

```
[禁用] [设为管理员] [调整余额] [重置密码]
```

**后端新增**：
- `PATCH /v1/admin/users/{id}` → `{ role?, status?, walletAdjust? }`
  - `role`: "admin" | "user" — 修改角色
  - `status`: "active" | "disabled" — 禁用/启用
  - `walletAdjust`: number — 加减 xtokens 余额（正数加，负数减）
- `POST /v1/admin/users/{id}/reset-password` → 重置密码（生成临时密码或发验证码）

**前端交互**：
- 禁用/启用：确认弹窗 → PATCH status
- 设为管理员：确认弹窗 → PATCH role
- 调整余额：输入框弹窗（金额+备注）→ PATCH walletAdjust
- 行内操作用小按钮 / 三点菜单

---

## Step 8: 平台参数配置

**新页面**: `apps/web/src/pages/admin/SettingsPage.tsx`
**路由**: `/admin/settings`

```
┌──────────────────────────────────────────────────────────┐
│  平台配置                                                 │
│                                                           │
│  经济参数                                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 新用户初始赠送    [1000000] xtokens                  │  │
│  │ 供应者分成比例    [85] %                             │  │
│  │ 每分钟速率限制    [60] 次/API Key                    │  │
│  │ 邀请配额默认值    [5] 个                             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  定价控制                                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 最低 Input 价格   [100] per 1K tokens               │  │
│  │ 最低 Output 价格  [200] per 1K tokens               │  │
│  │ 最高 Input 价格   [10000] per 1K tokens             │  │
│  │ 最高 Output 价格  [20000] per 1K tokens             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  [保存配置]                                               │
└──────────────────────────────────────────────────────────┘
```

**实现**：
- 后端：新建 `platform_config` 表（key-value），或用环境变量 + 可热更新的配置
- 简单方案：`GET/PUT /v1/admin/config` → 读写配置 JSON
- 前端：表单 + 保存按钮，保存后即时生效

---

## Step 9: Provider 管控

**新页面**: `apps/web/src/pages/admin/ProvidersPage.tsx`
**路由**: `/admin/providers`

```
┌──────────────────────────────────────────────────────────┐
│  Provider 管控                                            │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Provider      │ 状态  │ Offerings │ 请求数 │ 操作    │  │
│  │ DeepSeek      │ 🟢   │ 27       │ 21    │ [管理]  │  │
│  │ MiniMax       │ 🟢   │ 3        │ 5     │ [管理]  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  点击 [管理] 展开：                                       │
│  - 全局启用/禁用该 provider                               │
│  - 查看所有 offerings 列表                                │
│  - 强制下架某个 offering                                  │
│  - 设置该 provider 的最低/最高定价                         │
└──────────────────────────────────────────────────────────┘
```

**后端新增**：
- `GET /v1/admin/providers` → 按 providerType 聚合的 offerings/请求统计
- `PATCH /v1/admin/offerings/{id}/force-disable` → 强制下架

---

## Step 10: 系统通知

**数据库**: 新建 `notifications` 表

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- 'announcement' | 'system' | 'personal'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  target_user_id TEXT,         -- NULL = 全体通知, 有值 = 个人通知
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ       -- 可选过期时间
);

CREATE TABLE notification_reads (
  notification_id TEXT REFERENCES notifications(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);
```

**管理员端**（Admin）：
- 新页面 `/admin/notifications`：创建/管理公告
- 表单：标题、内容（支持 Markdown）、类型（公告/系统）、目标（全体/指定用户）、过期时间
- 列表：已发布通知 + 阅读统计

**用户端**：
- Header 头像旁增加铃铛图标 🔔 + 未读数 badge
- 点击展开通知列表（下拉面板）
- 或新增 `/app/notifications` 页面显示完整通知列表
- 通知类型：
  - `announcement`：管理员发布的公告（如维护通知、新功能上线）
  - `system`：系统自动生成（如余额不足警告、offering 被下架、审核结果）
  - `personal`：管理员给特定用户的消息

**后端新增**：
- `GET /v1/notifications` → 当前用户的通知列表（公告 + 个人）
- `POST /v1/notifications/{id}/read` → 标记已读
- `GET /v1/notifications/unread-count` → 未读数
- `POST /v1/admin/notifications` → 创建通知（admin only）
- `GET /v1/admin/notifications` → 管理通知列表

---

## Step 11: 审计日志查看

在 Admin Overview 或单独页面显示审计日志：

```
┌────────────────────────────────────────────────────────┐
│ 时间       │ 操作者     │ 动作              │ 目标     │
│ 3/22 14:23 │ test123   │ offering.reviewed │ off_xxx │
│ 3/22 14:20 │ ccc       │ credential.create │ cred_xx │
└────────────────────────────────────────────────────────┘
```

**后端**：`GET /v1/admin/audit-logs?limit=50` → 已有 audit_logs 表，只需加端点

---

## 文件清单（完整）

| 文件 | 操作 |
|------|------|
| **Admin 前端** | |
| `AdminOverviewPage.tsx` | 重写：趋势图 + 最近请求 + Provider 健康 |
| `UsersPage.tsx` | 重写：搜索/筛选 + 操作按钮 + 余额 |
| `AdminInvitationsPage.tsx` | 修复字段 + 状态颜色 + 撤销 |
| `ReviewsPage.tsx` | 修复字段 + 用户信息 + 定价 |
| `UsagePage.tsx` | 重写：时间筛选 + Top 用户 |
| `SettingsPage.tsx` | 新建：平台参数配置 |
| `ProvidersPage.tsx` | 新建：Provider 管控 |
| `AdminNotificationsPage.tsx` | 新建：通知管理 |
| `AdminLayout.tsx` | 增加菜单项 + 移动端 |
| **用户前端** | |
| `Header.tsx` | 增加通知铃铛 + 未读 badge |
| `NotificationsPage.tsx` 或下拉 | 新建：用户通知列表 |
| **后端** | |
| `routes/admin.ts` | 新增 6+ 端点 |
| `routes/notification.ts` | 新建：通知路由 |
| `postgres-platform-repository.ts` | 新增查询方法 |
| `platform-repository.ts` | 接口扩展 |
| **数据库** | |
| `007_notifications.sql` | notifications + notification_reads 表 |
| `008_platform_config.sql` | platform_config 表（可选） |
| **i18n** | |
| `i18n.ts` | Admin + 通知相关 keys |

## 验证

1. `/admin` — 5 卡片 + 趋势图 + 最近请求 + Provider 健康
2. `/admin/users` — 搜索 + 筛选 + 操作（禁用/角色/余额）
3. `/admin/invitations` — 字段正确 + 状态颜色 + 撤销
4. `/admin/reviews` — 用户邮箱 + 定价 + 拒绝原因
5. `/admin/usage` — 时间筛选 + Top 用户
6. `/admin/settings` — 配置参数可保存
7. `/admin/providers` — Provider 列表 + 管控操作
8. `/admin/notifications` — 创建公告 + 查看阅读统计
9. Header 铃铛 — 未读数 badge + 通知下拉/页面
10. 移动端 admin 布局正常
11. `npm run build` 通过
