# 分布式节点路由分离 + UI 统一列表

## Context

当前模型网络页面把平台模型和分布式节点分成两个 section 展示，统计数据也分开。需要：
1. 混合到一个列表，用标签区分
2. 分布式节点必须用户主动加入才路由（不自动混入默认池）
3. 分布式节点卡片显示运营者 `@handle (displayName)`

## 设计

### 卡片类型

**平台模型节点卡片（蓝色边框）：**
```
┌──────────────────────────────────┐
│ deepseek-chat            ●在线   │
│ ☁️ 平台节点                      │
│ 供应者: 3  上下文: 64K           │
│ 价格: 500/1500  请求: 2.3k       │
│ ▓▓▓▓▓▓░░░░  📈                  │
└──────────────────────────────────┘
```
- 按模型名聚合（一张卡片 = 一个模型的所有平台供应者）
- 点击 → 模型详情页（`/mnetwork/{logicalModel}`）
- 显示：供应者数量、上下文长度、均价、总请求、热度条 + sparkline

**分布式节点卡片（紫色边框）：**
```
┌──────────────────────────────────┐
│ deepseek-chat            ●在线   │
│ 🖥️ 分布式                       │
│ @xu-a1b2 (sunrisepeak)          │
│ 价格: 600/1800  请求: 120  👍 5  │
│ 连续运行: 3d 12h                 │
└──────────────────────────────────┘
```
- 每个 offering 独立一张卡片
- 点击 → 节点详情页（`/mnetwork/node/{publicNodeId}`）
- 显示：运营者 @handle (displayName)、价格、请求数、点赞、运行时长

### 排序

两种卡片混合排序，规则：
1. 按模型名字母序（同模型名的平台节点和分布式节点相邻）
2. 同模型名内：平台节点在前，分布式节点按请求数/信誉排

### 筛选

保留现有筛选 + 添加类型筛选：
- 全部 | ☁️ 平台 | 🖥️ 分布式

### 统计数据

顶部统计合并计算：
- 模型数 = 平台模型数 + 分布式模型数（去重）
- 节点数 = 平台供应者数 + 分布式节点数
- 供应者数 = 平台供应者 + 分布式运营者（去重）
- token 数 = 总 token

趋势图包含两种类型的数据。

## 路由层改动

**文件:** `apps/platform-api/src/routes/chat.ts:46-48`

```typescript
// 现在:
} else {
  offerings = await getAllOfferings(logicalModel, includeNodes);
}

// 改为:
} else {
  offerings = await getAllOfferings(logicalModel, false); // 只有平台节点
}
```

一行改动：用户 connection_pool 为空时，只 fallback 到平台节点，不混入分布式节点。

## 前端改动

**文件:** `apps/web/src/pages/ModelsPage.tsx`

1. 删除 Section 4（独立的分布式节点区域）
2. 在 Section 3 的 grid 中混合两种卡片
3. 添加类型筛选 tab：全部 | 平台 | 分布式
4. 分布式节点卡片添加 `@handle (displayName)` 显示

**文件:** `apps/web/src/lib/i18n.ts`

添加筛选标签翻译 key。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `apps/platform-api/src/routes/chat.ts` | L48: `includeNodes` → `false` |
| `apps/web/src/pages/ModelsPage.tsx` | 合并两种卡片到统一列表 |
| `apps/web/src/lib/i18n.ts` | 筛选标签 key |

## 验证

1. `npm run build` + `npm run test:platform-api` — 通过
2. `npm run test:e2e:mvp` — 通过
3. 访问模型网络页面 — 两种卡片混合显示，标签区分
4. 没加入 connection_pool 的用户 — 聊天只走平台节点
5. 加入分布式节点后 — 聊天路由到该节点
