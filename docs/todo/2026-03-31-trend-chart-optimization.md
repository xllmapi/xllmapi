# 优化：模型趋势图默认指标 + 颜色区分

## Context

趋势图有两个问题：
1. 默认显示"请求量"，应改为"Token量"
2. 新模型（gpt-5.4、mimo、kimi-for-coding 等）没有预定义颜色，全部用灰色系 fallback，难以区分

Token 数据来源是 `api_requests.total_tokens`（API tokens），非 xtokens。

## 修复

**文件**: `apps/web/src/pages/ModelsPage.tsx`

### 1. 默认指标改为 tokens

Line 268: `useState<TrendMetric>("requests")` → `useState<TrendMetric>("tokens")`

### 2. 动态颜色生成（无需预设）

移除 `MODEL_COLORS` 硬编码表。用模型名的**稳定 hash** 在 HSL 色环上均匀分布，确保：
- 同一个模型名永远得到同一个颜色（跨页面/刷新一致）
- 不同模型的色相间距最大化
- 不依赖预设列表，任意新模型自动获得高对比度颜色

```typescript
/** Generate a stable, high-contrast color from model name */
function getModelColor(name: string): string {
  // Stable hash: djb2
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) >>> 0;
  }
  // Use golden angle (137.508°) spacing for maximum hue separation
  const hue = (hash * 137.508) % 360;
  return `hsl(${Math.round(hue)}, 70%, 60%)`;
}
```

**golden angle (黄金角度 137.508°)** 是自然界中向日葵种子排列使用的角度，能在任意数量的点上实现色相的最大间距。比简单的 `hash % 360` 分布更均匀。

删除 `MODEL_COLORS` 和 `FALLBACK_COLORS` 常量，`getModelColor` 不再需要 `idx` 参数。

### 3. 后端增加 xtokens 数据

**文件**: `apps/platform-api/src/repositories/postgres-platform-repository.ts` line 2688

SQL 增加 xtokens 计算（JOIN settlement_records）：
```sql
COALESCE(SUM(sr.consumer_cost), 0)::bigint AS xtokens,
...
LEFT JOIN settlement_records sr ON sr.request_id = ar.id
```

趋势数据结构 `{ requests, tokens, xtokens, users, avgPrice }`。

### 4. 前端增加 tokens/xtokens 切换

**文件**: `apps/web/src/pages/ModelsPage.tsx`

- TrendMetric 类型增加 `"xtokens"`：`type TrendMetric = "requests" | "tokens" | "xtokens" | "price"`
- 默认改为 `"xtokens"`
- 按钮组增加 "XTokens" 选项
- chart metric 选择增加 xtokens 分支

## 改动文件

| 文件 | 改动 |
|------|------|
| `apps/web/src/pages/ModelsPage.tsx` | 默认 tokens + 动态颜色 + xtokens 指标 |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | SQL 增加 xtokens |
| `apps/web/src/lib/i18n.ts` | 新增 `models.trends.xtokens` 翻译 |

## 验证

1. `npm run build`
2. 本地打开 /mnetwork 检查趋势图默认显示 Token 量
3. 每个模型颜色清晰可区分（动态生成，无需预设）
4. 可切换到 XTokens 查看消费量
