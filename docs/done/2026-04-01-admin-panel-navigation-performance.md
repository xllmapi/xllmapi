# 管理面板菜单切换性能优化

**日期**: 2026-04-01
**状态**: 已完成 (PR #59 merged)
**问题**: 管理面板每次点击菜单延迟高，显示 "Loading…" 后才出现页面

---

## 问题根因分析

### 延迟链路

```
点击菜单 → ① JS Chunk 下载(lazy) → ② Suspense "Loading…" → ③ API 请求(无缓存) → ④ 页面渲染
```

### 根因 1: React.lazy chunk 加载延迟

- **文件**: `apps/web/src/App.tsx:58-75`
- 18 个 admin 页面全部 `React.lazy()` 动态导入
- 全局单一 `<Suspense fallback={<PageLoader />}>` (L95)
- 首次访问每个页面都要下载 JS chunk → 显示 "Loading…"

### 根因 2: 页面级数据无缓存

- 每个 admin 页面 `useState(true)` 初始 loading
- `useEffect` 中请求 API，完成后 `setLoading(false)`
- 离开页面再回来，数据从零重新请求
- **无客户端缓存机制**

### 根因 3: 后端慢查询

- `listAdminUsers()` (L1290): 5 个标量子查询/每行用户，N+1 模式，无分页
- AdminOverviewPage 并发 7 个 API，其中 `/v1/admin/users` 加载全量用户列表仅为取 count
- 后端 admin 读 API 无任何缓存

---

## 优化方案

### 方案 A: Admin chunk 预加载

**目标**: 消除首次访问页面的 chunk 下载延迟

**实现**:
1. 将 admin 页面的 import 函数提取为 `adminPageImports` 数组
2. 在 `AdminLayout` mount 后用 `requestIdleCallback` 批量预加载
3. 浏览器空闲时自动下载所有 admin chunk

**修改文件**:
- `apps/web/src/App.tsx` — 提取 import 函数
- `apps/web/src/components/layout/AdminLayout.tsx` — 添加预加载

### 方案 B: 客户端 stale-while-revalidate 缓存

**目标**: 回访页面零 loading，后台静默刷新

**实现**:
1. 创建 `useAdminData` hook，内存缓存 + TTL + 后台刷新
2. 有缓存时直接渲染，后台静默 refetch
3. 无缓存时正常 loading → 请求 → 缓存

**修改文件**:
- 新增 `apps/web/src/hooks/useAdminData.ts`
- 改造各 admin 页面使用新 hook

### 方案 C: 优化 listAdminUsers + Overview 数据源

**目标**: 消除最慢的 API 调用

**实现**:
1. `/v1/admin/stats` 增加 `userCount` 字段（简单 COUNT 查询）
2. AdminOverviewPage 用 `stats.userCount` 替代全量用户 API
3. `listAdminUsers` 子查询改为 JOIN + GROUP BY

**修改文件**:
- `apps/platform-api/src/repositories/postgres-platform-repository.ts` (L1290)
- `apps/platform-api/src/routes/admin.ts`
- `apps/web/src/pages/admin/AdminOverviewPage.tsx`

### 方案 D: 后端 admin 缓存

**目标**: 减少数据库压力

**实现**:
- 对 admin 读 API 加内存/Redis 缓存，TTL 1-10min
- 优先: `/v1/admin/stats`(5min), `/v1/admin/providers`(10min), `/v1/admin/config`(30min)

**修改文件**:
- `apps/platform-api/src/routes/admin.ts`
- `apps/platform-api/src/cache.ts`

---

## 实施计划

| Step | 内容 | 依赖 | 可并行 |
|------|------|------|--------|
| 1 | Admin chunk 预加载 (方案A) | 无 | Yes |
| 2 | useAdminData 缓存 hook (方案B) | 无 | Yes |
| 3 | 优化 listAdminUsers + stats API (方案C) | 无 | Yes |
| 4 | 后端 admin 缓存 (方案D) | 无 | Yes |
| 5 | 改造 admin 页面使用新 hook | Step 2 | No |
| 6 | 单元测试 + E2E 测试 | Step 1-5 | No |
| 7 | 本地模拟测试 + 性能对比 | Step 6 | No |

---

## 本地模拟测试结果

### 优化前基线

| 端点 | 响应时间 |
|------|---------|
| /v1/admin/users | 22 ms |
| /v1/admin/stats | 5 ms |
| /v1/admin/usage | 22 ms |
| /v1/admin/providers | 6 ms |
| /v1/admin/config | 4 ms |
| AdminOverview 7 API 并行 | 15 ms wall |
| Admin chunk 大小 | 4-20 KB each |
| 回访页面 | 必闪 "Loading…" (无缓存) |

### 优化后

| 端点 | 首次 | 缓存命中 |
|------|------|---------|
| /v1/admin/users (CTE) | 9 ms | - |
| /v1/admin/stats (+userCount) | 2 ms | 1 ms |
| /v1/admin/usage | 16 ms | - |
| /v1/admin/providers | 8 ms | 3 ms |
| /v1/admin/config | 6 ms | 3 ms |
| AdminOverview 6 API 并行 | 27 ms wall | 15 ms wall |
| 回访页面 | **零 loading 闪烁** (stale-while-revalidate) |
| Chunk 预加载 | AdminLayout mount 后空闲时自动加载所有 admin chunk |

### 关键改进

1. **AdminOverviewPage 减少 1 个 API 调用**: 不再请求全量 `/v1/admin/users`（仅为取 count），改用 `stats.userCount`
2. **listAdminUsers CTE 优化**: 5 个 N+1 子查询 → 3 个 CTE + LEFT JOIN，查询复杂度从 O(N*M) 降为 O(N+M)
3. **前端 stale-while-revalidate 缓存**: 回访页面直接用缓存渲染，后台静默刷新
4. **Admin chunk 预加载**: 进入 admin 后 requestIdleCallback 预加载所有页面 chunk
5. **后端 TTL 缓存**: stats(5min), providers(10min), config(30min)
6. **已迁移页面**: AdminOverviewPage, AdminAuditPage, AdminSecurityEventsPage, AdminEmailDeliveriesPage, AdminReleasesPage

### 测试通过

- 155/155 单元测试通过
- 构建成功 (web + platform-api)
- 本地 API 集成验证: 所有端点返回正确数据
- listAdminUsers CTE 查询: 返回 118 用户，所有字段完整
