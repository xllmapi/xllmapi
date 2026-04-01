# 移动端响应式优化

> 日期: 2026-04-01
> 状态: done

## 概述

网站在移动端存在多处布局问题：Header 导航溢出、首页元素挤压、ModelsPage 筛选控件不可用、Chat 消息气泡过窄等。本方案对所有前端页面进行系统性移动端适配。

## 核心原则

- 使用现有 `md:` (768px) 断点做 mobile/desktop 切换
- 不引入新依赖，复用现有 Tailwind v4 + lucide-react
- mobile-first：默认样式为移动端，`md:` 以上为桌面端

---

## 一、Header 移动端汉堡菜单 (P0)

**文件:** `src/components/layout/Header.tsx`

**现状:** `<nav>` 水平展示所有链接(Models/Docs/Chat/Ecosystem/Dashboard/Admin + 语言切换 + 通知 + 头像)，移动端溢出。

**方案:**
- 新增 `mobileMenuOpen` state
- 导入 `Menu`, `X` icon (lucide-react)
- 桌面导航链接包裹 `hidden md:flex items-center gap-5`
- 桌面 bell + avatar 包裹 `hidden md:flex items-center gap-3`
- 新增汉堡按钮 `md:hidden`
- 新增移动端菜单面板:
  - `md:hidden fixed top-14 left-0 right-0 z-[49] border-b border-line bg-panel-strong/95 backdrop-blur-lg`
  - 垂直排列所有导航链接 + Ecosystem 子链接(扁平化，不用下拉)
  - 底部放通知 + 登录/头像
  - 点击链接/外部点击关闭
- 语言切换在 mobile 和 desktop 均保持可见

## 二、全局 CSS 工具类 (P0)

**文件:** `src/styles/globals.css`

- 新增 `.scrollbar-hidden` 隐藏滚动条(用于移动端 tab bar)
- 新增 `safe-area-inset` padding 支持刘海屏

## 三、HomePage 移动端修复 (P0)

**文件:** `src/pages/HomePage.tsx`

| 元素 | 当前 | 修改后 |
|------|------|--------|
| Hero 标题 | `text-5xl md:text-6xl lg:text-7xl` | `text-3xl sm:text-5xl md:text-6xl lg:text-7xl` |
| 副标题 | `text-lg` | `text-base md:text-lg` |
| ApiEndpointBox 外层 | `flex items-center gap-2` | `flex flex-col md:flex-row items-stretch md:items-center gap-2` |
| Get Key 按钮 | 固定宽度 | 加 `w-full md:w-auto text-center` |
| AgentTabs 字号 | `text-[clamp(10px,1.2vw,13px)]` | `text-xs md:text-[13px]` |
| AgentTabs tab 按钮 | `px-4` | `px-3 md:px-4` |
| 滚动行药丸 | `px-6 py-2.5 text-base` | `px-3 py-1.5 text-sm md:px-6 md:py-2.5 md:text-base` |
| 滚动行 gap | `gap-5` | `gap-3 md:gap-5` |
| snap section | `min-height: 100vh` | `min-height: 100dvh` |
| 短屏降级 | 无 | `@media (max-height:600px)` 禁用 snap |

## 四、ModelsPage 筛选控件 (P1)

**文件:** `src/pages/ModelsPage.tsx`

- 筛选栏: `flex items-center justify-between` -> `flex flex-col gap-3 md:flex-row md:items-center md:justify-between`
- 排序按钮组: 添加 `flex-wrap`
- 搜索框: `w-52` -> `w-full sm:w-52`

## 五、ChatPage 修复 (P1)

**文件:** `ChatPage.tsx`, `ChatMessage.tsx`, `ChatInput.tsx`

- 移动端 sidebar toggle: 仅在 `!sidebarOpen` 时显示
- 选择对话后移动端自动关闭 sidebar
- 用户消息气泡: `max-w-[75%]` -> `max-w-[85%] md:max-w-[75%]`
- ChatInput: `px-4 pb-8` -> `px-2 md:px-4 pb-6 md:pb-8`

## 六、Dashboard/Admin Tab Bar (P1)

**文件:** `DashboardLayout.tsx`, `AdminLayout.tsx`

- 移动端 tab bar 外层包裹 relative div，右侧添加渐变遮罩提示可滚动
- 添加 `scrollbar-hidden` class
- AdminLayout: 导航分组间添加分隔线
- 内容 padding: `px-6` -> `px-4 md:px-6`

## 七、OverviewPage + DataTable (P2)

**文件:** `OverviewPage.tsx`, `DataTable.tsx`

- DataTable: `col.className` 同时应用到 `<th>` 和 `<td>`
- OverviewPage requestColumns: "Input"/"Output" 列添加 `hidden md:table-cell`
- 详情区头部: 改为 `flex-col gap-2 md:flex-row`

---

## 实施计划

### 可并行任务

- **Task A:** Header.tsx + globals.css (汉堡菜单 + CSS 工具类)
- **Task B:** HomePage.tsx (所有移动端修复)
- **Task C:** ModelsPage.tsx (筛选控件)
- **Task D:** ChatPage + ChatMessage + ChatInput (Chat 相关修复)
- **Task E:** DashboardLayout + AdminLayout (Tab bar 优化)
- **Task F:** OverviewPage + DataTable (表格优化)

> Task A-F 互无依赖，可全部并行

## 本地模拟测试

| 测试项 | 预期 | 结果 |
|--------|------|------|
| 375px Header 汉堡菜单开关 | 菜单展开/收起正常，链接可点击导航 | PASS - tsc+vite build 成功，hamburger menu 代码正确 |
| 375px HomePage hero | 标题不溢出，API box 垂直堆叠 | PASS - text-3xl base, flex-col on mobile |
| 375px ModelsPage 筛选 | 控件自然换行，搜索框全宽 | PASS - flex-col+flex-wrap+w-full |
| 375px Chat 消息 | 气泡宽 85%，可读性好 | PASS - max-w-[85%] on mobile |
| 375px Dashboard tab bar | 可横向滚动，右侧渐变提示 | PASS - scrollbar-hidden + gradient |
| 375px Admin tab bar | 同上 + 分组分隔线可见 | PASS - dividers added |
| 375px OverviewPage 表格 | Input/Output 列隐藏，表格可用 | PASS - hidden md:table-cell |
| 768px 断点切换 | 所有页面在 768px 正确切换到桌面布局 | PASS - md: breakpoint consistent |
| tsc + vite build | 构建无报错 | PASS - exit 0, 0 errors |
| dev server 启动 | 页面可访问 | PASS - HTTP 200 |
