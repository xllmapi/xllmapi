# 模型网络 + 市场整合 + 节点模型验证

## Context

当前 `/mnetwork`（模型概览+趋势）和 `/market`（市场交易）是两个独立页面，内容有重叠。用户希望合并为一个路由，用 tab 切换：[概览] [市场] [排行]。同时需要实现节点模型真实性验证。

---

## Part 1: 页面整合（/mnetwork → tab 布局）

### 路由
- 保留 `/mnetwork` 作为主路由
- `/market` 重定向到 `/mnetwork?tab=market`
- `/mnetwork/:logicalModel` 模型详情页保留

### Tab 结构

```
┌──────────────────────────────────────────────────────────┐
│  模型网络                                                 │
│                                                           │
│  3 模型   4 节点   3 供应者   6.1K 总xtokens              │
│                                                           │
│  [概览]  [市场]  [排行]                                    │
│                                                           │
│  ─── 概览 tab ───                                         │
│  排序+搜索 + 3列模型卡片 + 趋势图                          │
│  （当前 ModelsPage 的内容）                                 │
│                                                           │
│  ─── 市场 tab ───                                         │
│  Offering 列表（价格、供应者、评分、在线状态）              │
│  筛选：模型、价格范围、provider 类型                        │
│  （当前 MarketPage 的内容）                                │
│                                                           │
│  ─── 排行 tab ───                                         │
│  模型使用量排名表 + Market Share 面积图                     │
│  供应者排名（贡献 token 最多的供应者）                      │
└──────────────────────────────────────────────────────────┘
```

### 实现方式
- ModelsPage.tsx 增加 tab state（`overview` | `market` | `ranking`）
- URL search param `?tab=market` 控制初始 tab
- 概览 tab: 保持现有内容（模型卡片+趋势图）
- 市场 tab: 将 MarketPage 内容提取为组件嵌入
- 排行 tab: 新建排行内容（模型排名表+供应者排名）

### 文件改动
| 文件 | 操作 |
|------|------|
| `apps/web/src/pages/ModelsPage.tsx` | 增加 tab 切换，嵌入市场和排行内容 |
| `apps/web/src/pages/MarketPage.tsx` | 提取核心内容为组件，或直接合入 ModelsPage |
| `apps/web/src/App.tsx` | `/market` 路由改为 redirect 到 `/mnetwork?tab=market` |
| `apps/web/src/components/layout/Header.tsx` | 导航栏移除独立的 Market 链接 |
| `apps/web/src/lib/i18n.ts` | 新增 tab 相关 keys |

---

## Part 2: 节点模型验证

### 接入验证（capabilities 收到后）

在 `node-connection-manager.ts` 处理 `capabilities` 消息时，对每个声明的模型发送测试请求：

```
Node connects → auth.ok → capabilities received
                              ↓
              For each model in capabilities:
                ├─ Send test request via node: "Reply with: MODEL_CHECK_OK"
                ├─ Wait 15s timeout
                ├─ Check response contains "MODEL_CHECK_OK"
                ├─ Pass → create/enable offering
                └─ Fail → skip model, log warning
```

### 实现
- 在 `handleCapabilities()` 中，对每个 model 调用 `nodeConnectionManager.dispatch()` 发送测试请求
- 测试 prompt: `"Reply with exactly: MODEL_CHECK_OK"` + `max_tokens: 16`
- 验证响应包含 `MODEL_CHECK_OK`
- 通过的模型才创建 offering，失败的跳过并记录

### 文件改动
| 文件 | 操作 |
|------|------|
| `apps/platform-api/src/core/node-connection-manager.ts` | 在 capabilities handler 中增加验证逻辑 |

---

## 验证

1. `/mnetwork` 显示 3 个 tab，默认概览
2. `/mnetwork?tab=market` 直接切到市场
3. `/market` 重定向到 `/mnetwork?tab=market`
4. Header 导航无独立 Market 链接
5. 节点连接后，capabilities 中的模型经过测试请求验证
6. `npm run build` 通过
