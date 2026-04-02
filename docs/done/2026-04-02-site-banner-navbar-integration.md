# 全站公告集成到导航栏 — 消除与主内容重叠

## 问题分析

当前 `SiteBanner` 是独立 `fixed` 定位元素（`top: 56px, z-40`），与 `Header`（`fixed top-0 z-50`）分离渲染。导致：

1. **Banner 浮在主内容上方**，遮挡页面内容
2. **间距硬编码不一致**：DashboardLayout/AdminLayout 用 `pt-[72px]`（56+16），但 banner 高 28px，存在 12px 差距
3. **ChatPage 完全不感知 banner**：用 `top-[56px]`，banner 显示时直接遮挡
4. **Mobile menu** `top-14` 也不随 banner 动态调整

## 优化方案

### 核心思路

将 SiteBanner 从独立 fixed 元素改为 Header 组件内部的子元素。Header 成为包含「导航 + 可选公告」的整体 fixed 块。通过 CSS 变量 `--header-height` 驱动所有下游组件的间距。

### 布局结构

```
Header (fixed, z-50)
├── nav bar (h-14 = 56px)
└── banner (h-7 = 28px, 仅在有公告时显示)

Main content (top/pt = var(--header-height))
```

### 实现步骤

#### 1. 新建 `useSiteBanner` hook

文件：`apps/web/src/hooks/useSiteBanner.ts`

提取 banner 数据获取 + dismiss 逻辑为共享 hook，返回 `{ banner, dismissed, dismiss, visible }`。

#### 2. 改造 Header 组件

文件：`apps/web/src/components/layout/Header.tsx`

- 调用 `useSiteBanner()`
- 在 `<header>` 内、导航内容下方渲染 banner 条
- 移除固定 `h-14`，改为动态高度
- `useEffect` 设置 `document.documentElement.style.setProperty('--header-height', visible ? '84px' : '56px')`
- Mobile menu `top` 改用 CSS 变量

#### 3. 移除独立 SiteBanner 渲染

文件：`apps/web/src/App.tsx`

- 删除 `<SiteBanner />` 及其 import

#### 4. 更新下游组件间距

用 `var(--header-height, 56px)` 替换硬编码值：

| 文件 | 当前 | 改为 |
|------|------|------|
| `DashboardLayout.tsx` | `pt-[72px]`, `top-[72px]` | `pt-[calc(var(--header-height,56px)+16px)]`, `top-[calc(var(--header-height,56px)+16px)]` |
| `AdminLayout.tsx` | `pt-[72px]`, `top-[72px]` | 同上 |
| `ChatPage.tsx` | `top-[56px]`, `top-[72px]` | `top-[var(--header-height,56px)]`, `top-[calc(var(--header-height,56px)+16px)]` |

#### 5. 删除 SiteBanner.tsx

Banner UI 已内嵌到 Header，该文件不再需要。

### 并行化分析

- **Task A**: 新建 `useSiteBanner` hook（独立）
- **Task B**: 改造 Header + 内嵌 banner（依赖 A）
- **Task C**: 更新 DashboardLayout + AdminLayout 间距（依赖 B 的 CSS 变量）
- **Task D**: 更新 ChatPage 间距（依赖 B 的 CSS 变量）
- **Task E**: 清理 App.tsx + 删除 SiteBanner.tsx（依赖 B）

A 先行，B 依赖 A，C/D/E 可在 B 完成后并行。

## 验证结果

1. `npm run build` — 编译通过
2. `npm run test:platform-api` — 155/155 测试通过
3. 本地 dev 环境验证（banner 当前启用状态）：
   - [x] Banner 内嵌在 Header 内部，`border-t` 分隔 nav 和 banner
   - [x] CSS 变量 `--header-height` 动态设置（有 banner: 84px, 无: 56px）
   - [x] DashboardLayout/AdminLayout 用 `calc(var(--header-height)+16px)` 自适应
   - [x] ChatPage 用 `var(--header-height)` 自适应
   - [x] ChatSidebar mobile drawer 用 `var(--header-height)` 自适应
   - [x] Mobile menu 用 `var(--header-height)` 自适应
   - [x] 无 banner 时所有 fallback 默认 56px，与原始行为一致
   - [x] 编译产物中 `header-height` 变量正确出现在 index.js 和 ChatPage.js
