# 统一 useCachedFetch — 全面消除页面切换加载闪烁

**日期**: 2026-04-02
**状态**: 进行中
**问题**: KeepAlive 在跨 Layout 导航时失效，27/32 页面仍无缓存

---

## 方案

泛化 useAdminData → useCachedFetch，module-level Map 缓存跨布局存活，全量迁移所有页面。

## 改动文件

### Phase 1: 统一 hook
- `apps/web/src/hooks/useCachedFetch.ts` — 新增（从 useAdminData 演化）
- `apps/web/src/hooks/useAdminData.ts` — 删除（改为 re-export useCachedFetch）

### Phase 2: 迁移管理页面 (13 个)
- UsersPage, AdminInvitationsPage, UsagePage, AdminRequestsPage
- AdminSettlementFailuresPage, AdminSettlementsPage, ReviewsPage
- AdminNodeHealthPage, ProvidersPage, AdminNotificationsPage
- AdminLogsPage, AdminBannerPage, SettingsPage

### Phase 3: 迁移控制台页面 (~7 个)
- OverviewPage, ModelsManagePage, InvitationsPage
- ApiKeysPage, SecurityPage, NotificationsPage, ProfilePage

### Phase 4: 已有 useAdminData 引用更新 (5 个)
- AdminOverviewPage, AdminAuditPage, AdminSecurityEventsPage
- AdminEmailDeliveriesPage, AdminReleasesPage

## 本地模拟测试（待记录）

- 管理页面内切换: 回访瞬间显示
- 控制台页面内切换: 回访瞬间显示
- 跨导航切换再回来: 回访瞬间显示
- Puppeteer 自动化验证
