# 模型按供应商分开显示

## Context

当前模型列表页 (`/mnetwork`) 按 `logicalModel` 聚合显示，同一模型名（如 `gpt-5.4`）即使来自不同供应商（OpenAI 官方 vs OpenAI-AH 第三方），也只显示一张卡片。用户无法直观区分来源和信任度。

**目标：** 同一 `logicalModel` 来自不同 `provider_preset` 的 → 分开显示为独立卡片，各自有独立的统计数据。

## 变更范围

### 1. 共享类型 — `packages/shared-types/src/api/market.ts`

`PublicMarketModel` 接口新增：
```typescript
presetId?: string | null;     // provider preset ID
presetLabel?: string | null;  // "OpenAI", "OpenAI-AH(no-official)"
```

### 2. 后端核心 — `postgres-platform-repository.ts`

#### 2a. `listModels()` 主查询（~line 1327）

- GROUP BY 从 `o.logical_model` 改为 `o.logical_model, COALESCE(p.id, '__unknown__'), p.label, p.third_party, p.third_party_label, p.trust_level, p.third_party_notice`
- SELECT 新增 `COALESCE(p.id, '__unknown__') AS "presetId"`, `COALESCE(p.label, 'Unknown') AS "presetLabel"`
- 去掉聚合包装：`bool_or(p.third_party)` → `COALESCE(p.third_party, false)`，`MAX(p.third_party_label)` → `p.third_party_label` 等
- **防止多 preset 匹配**：将 LEFT JOIN provider_presets 改为 LEFT JOIN LATERAL + LIMIT 1（按 sort_order 取第一个匹配）
- ORDER BY 增加 `COALESCE(p.third_party, false) ASC, p.label ASC`（官方排前）

#### 2b. 7 天均价子查询（~line 1363）

- JOIN 到 offerings → credentials → presets
- GROUP BY 增加 `COALESCE(p.id, '__unknown__')`
- avgPriceMap key 改为 `${logicalModel}::${presetId}`

#### 2c. 结果组装循环（~line 1382）

- 使用复合 key 查 avgPriceMap
- push 时加入 `presetId`, `presetLabel` 字段

#### 2d. `getNetworkModelStats()`（~line 2781）

- 主查询和 7 天趋势查询都 JOIN 到 offerings → credentials → presets
- GROUP BY 增加 `COALESCE(p.id, '__unknown__')`
- 返回值加 `presetId` 字段
- trendMap key 改为 `${logicalModel}::${presetId}`

### 3. 后端路由 — `routes/network.ts`

- `GET /v1/models`（SDK 端点）：新增去重逻辑，同一 logicalModel 只保留第一个（官方）
- `GET /v1/network/models`、`/v1/network/models/stats`：无需改动，直接返回新数据

### 4. 前端模型列表 — `ModelsPage.tsx`

- `NetworkModel` 接口加 `presetId?`, `presetLabel?`
- `ModelStats` 接口加 `presetId?`
- `statsMap` key 从 `logicalModel` 改为 `${logicalModel}::${presetId}`
- 卡片 `key` 改为复合 key
- 卡片 UI：模型名下方显示 `presetLabel`（如 "via OpenAI-AH"）
- 导航：`/mnetwork/${model}?provider=${presetId}`
- 排序/过滤中的 statsMap 查找同步更新
- 搜索增加 presetLabel 匹配

### 5. 前端详情页 — `ModelDetailPage.tsx`

- 读取 URL `?provider=` 参数（`useSearchParams`）
- 模型查找：按 logicalModel + presetId 双重匹配（无 provider 参数时取第一个，向后兼容）
- 标题显示 `presetLabel`
- 第三方 banner 使用当前 preset 的数据
- 供应者列表仍基于 `/v1/market/offerings?logicalModel=xxx`，暂不按 preset 过滤（供应者已经隐含了 provider）

### 6. i18n — `apps/web/src/lib/i18n.ts`

新增 keys（如有需要）：
- `"models.provider"`: "供应商" / "Provider"
- `"models.unknownProvider"`: "未知供应商" / "Unknown Provider"

## 不改的部分

- **趋势图** (`/v1/network/trends`)：继续按 logicalModel 聚合，后续可增强
- **连接池 join/leave**：按 logicalModel 级别操作，不受影响
- **DB 迁移**：无需，所有字段已存在于 provider_presets 表
- **SQLite stub**：listModels/getNetworkModelStats 已有 stub，返回空数组即可

## 关键文件

| 文件 | 改动 |
|------|------|
| `packages/shared-types/src/api/market.ts` | 新增 presetId, presetLabel 字段 |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | listModels + getNetworkModelStats GROUP BY 改造 |
| `apps/platform-api/src/routes/network.ts` | SDK 端点去重 |
| `apps/web/src/pages/ModelsPage.tsx` | 卡片展示 + key + 导航 + stats 合并 |
| `apps/web/src/pages/ModelDetailPage.tsx` | provider 参数 + 双重匹配 |
| `apps/web/src/lib/i18n.ts` | 新 key（如需） |

## 验证

1. `npm run build` 通过
2. `npm run test:platform-api` 全部通过
3. 本地 dev-up，访问 `/mnetwork`：同一模型名不同供应商显示为独立卡片
4. 点击卡片进入详情页，URL 含 `?provider=xxx`，显示对应 preset 的数据
5. 旧 URL `/mnetwork/gpt-5.4`（无 provider 参数）仍然可用
6. `GET /v1/models` SDK 端点：同一 logicalModel 只返回一条
7. 卡片排序：官方 preset 排在第三方前面
