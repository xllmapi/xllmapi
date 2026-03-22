# 模型网络主页趋势图 设计方案

## 背景

模型网络页（`/mnetwork`）当前只有 4 个统计数字 + 模型卡片列表。缺少全网维度的趋势可视化，无法直观展示平台活跃度、增长趋势、价格波动等关键数据。

参考 OpenRouter Rankings 的 Top Models 面积图 + Market Share 图，在 stat 卡片下方、模型列表上方增加全网趋势图区域。

## 目标

在模型网络主页的 stat 卡片与模型列表之间，增加可视化趋势区域：

```
┌──────────────────────────────────────────────────────┐
│  3 模型    4 节点    3 供应者    6.1K 总xtokens       │
│                                                       │
│  ┌──────────────────────────────────────────────────┐│
│  │  全网趋势 (30天)                                  ││
│  │                                                   ││
│  │  [请求量] [Token量] [用户数] [均价]   ← tab 切换   ││
│  │                                                   ││
│  │  ╭──╮    ╭──────╮                                ││
│  │ ─╯  ╰────╯      ╰──────╮    ╭─╮                 ││
│  │                         ╰────╯ ╰──              ││
│  │  ── deepseek-chat  ── MiniMax-M2.7  ── ...      ││
│  │                                                   ││
│  │  3/1  3/5  3/10  3/15  3/20  3/22               ││
│  └──────────────────────────────────────────────────┘│
│                                                       │
│  [使用量▼] [Token量] [价格]    🔍 搜索模型            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ model 1  │ │ model 2  │ │ model 3  │             │
│  └──────────┘ └──────────┘ └──────────┘             │
└──────────────────────────────────────────────────────┘
```

## 技术方案

### 1. 新增后端 API

**端点**: `GET /v1/network/trends?days=30` (公开，无需登录)

**SQL**:
```sql
SELECT
  DATE(ar.created_at) AS day,
  ar.logical_model AS "logicalModel",
  COUNT(*) AS requests,
  SUM(ar.total_tokens) AS tokens,
  COUNT(DISTINCT ar.requester_user_id) AS users,
  COALESCE(AVG(o.fixed_price_per_1k_input), 0) AS "avgInputPrice",
  COALESCE(AVG(o.fixed_price_per_1k_output), 0) AS "avgOutputPrice"
FROM api_requests ar
LEFT JOIN offerings o ON o.id = ar.chosen_offering_id
WHERE ar.created_at > NOW() - INTERVAL '{days} days'
  AND ar.logical_model NOT LIKE 'community-%'
  AND ar.logical_model NOT LIKE 'e2e-%'
GROUP BY day, ar.logical_model
ORDER BY day ASC
```

**返回格式**:
```json
{
  "data": [
    {
      "date": "2026-03-22",
      "models": {
        "deepseek-chat": { "requests": 2, "tokens": 908, "users": 1, "avgPrice": 400 },
        "MiniMax-M2.7": { "requests": 3, "tokens": 882, "users": 1, "avgPrice": 1500 }
      }
    }
  ]
}
```

### 2. 前端图表

**方案**: 纯 SVG 实现（不引入 recharts），与现有 Sparkline/HeatBar 风格一致。

**TrendChart 组件**:
- 面积图（Area Chart）：X 轴=日期，Y 轴=值
- 多系列：每个模型一条线+填充区域，不同颜色
- 底部图例：模型名+颜色点
- 4 个 tab 切换指标：请求量 / Token 量 / 用户数 / 均价
- Hover tooltip 显示具体数值
- 响应式宽度（自适应容器宽度）

**颜色方案** (与现有主题一致):
- deepseek: `#8be3da` (accent)
- MiniMax: `#a78bfa` (紫)
- OpenAI: `#34d399` (绿)
- Anthropic: `#fb923c` (橙)
- 其他: `#94a3b8` (灰)

### 3. 文件改动

| 文件 | 操作 |
|------|------|
| `apps/platform-api/src/main.ts` | 新增 GET /v1/network/trends 端点 |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | 新增 getNetworkTrends() |
| `apps/platform-api/src/repositories/platform-repository.ts` | 接口增加 getNetworkTrends |
| `apps/platform-api/src/services/platform-service.ts` | 转发 getNetworkTrends |
| `apps/platform-api/src/repositories/sqlite-platform-repository.ts` | 空实现 |
| `apps/web/src/pages/ModelsPage.tsx` | 增加 TrendChart 区域 |
| `apps/web/src/lib/i18n.ts` | 新增趋势图相关 keys |

### 4. 验证

1. `curl /v1/network/trends?days=30` 返回按日期+模型聚合的数据
2. `/mnetwork` 页面 stat 卡片下方显示面积趋势图
3. 切换 tab（请求量/Token量/用户数/均价）图表更新
4. 图表下方显示模型图例
5. 图表宽度随窗口自适应
