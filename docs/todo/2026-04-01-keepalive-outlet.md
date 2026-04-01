# 路由级 KeepAlive — 消除菜单切换 "加载中..." 闪烁

**日期**: 2026-04-01
**状态**: 进行中
**问题**: 管理面板和控制台每次点击菜单都显示 "加载中..." 再出页面，PR #59 仅覆盖 5/27 页面无效

---

## 根因

每次菜单切换 → React Router 卸载旧组件 + 挂载新组件 → `useState(true)` → 显示 "加载中..." → API 请求 → 渲染。22/27 页面未使用缓存 hook。

## 方案

在 AdminLayout 和 DashboardLayout 的 `<Outlet />` 替换为 `<KeepAliveOutlet />`：
- 已访问的页面用 CSS `display:none` 隐藏而非卸载
- 再次访问时瞬间显示，状态完整保留
- 新增页面自动受益，零适配

## 改动文件

| 文件 | 改动 |
|------|------|
| `apps/web/src/components/layout/KeepAliveOutlet.tsx` | 新增 |
| `apps/web/src/components/layout/AdminLayout.tsx` | Outlet → KeepAliveOutlet |
| `apps/web/src/components/layout/DashboardLayout.tsx` | Outlet → KeepAliveOutlet |

## 本地模拟测试

### 优化前

- 每次菜单切换: 显示 "加载中..." (100% 页面)
- 回访已访问页面: 仍显示 "加载中..."

### 优化后 (puppeteer 自动化验证)

Admin 二次访问 (5/5 INSTANT):
- Users: INSTANT (74ms)
- Usage: INSTANT (57ms)
- Requests: INSTANT (59ms)
- Settlements: INSTANT (55ms)
- Settings: INSTANT (57ms)

Dashboard 二次访问 (3/3 INSTANT):
- Profile: INSTANT
- Security: INSTANT
- API Keys: INSTANT

DOM 验证: 隐藏页面保留在 DOM 中 (display:none), 状态完整保留
构建: 成功 (web + platform-api)
