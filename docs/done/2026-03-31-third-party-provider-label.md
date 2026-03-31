# 设计方案：第三方供应商标识

## Context

平台节点都是用户通过上游 API key 创建的。当前所有平台节点对用户自动可用。部分供应商使用非官方/第三方 API（如聚合平台），官方性弱。需要让管理员在**供应商预设配置页**标记第三方属性，使对应 offerings 在 marketplace 有视觉区分，且不自动对用户可用。

## 设计方案

### 1. 数据库：provider_presets 新增字段

```sql
-- 019_third_party_flag.sql
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS third_party BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS third_party_label TEXT;       -- 如 "聚合平台"
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'high';  -- high/medium/low
```

标识挂在 **preset** 上而非 offering 上 — 同一供应商预设下所有 offerings 统一标识。

### 2. 管理员供应商配置页增加第三方配置

**文件**: `apps/web/src/pages/admin/ProvidersPage.tsx`

在编辑表单的 `enabled` 开关后面增加：

```
── 第三方供应标识 ──
[○ 关闭  ● 开启]                          ← third_party toggle

(开启后显示：)
标识名称  [聚合平台]                        ← third_party_label input
可信度    [○ 高  ● 中  ○ 低]               ← trust_level radio
          高=官方渠道  中=聚合平台  低=未验证

颜色预览：  ■ 高(青色)  ■ 中(橙色)  ■ 低(红色)
```

对应 ProviderPreset 接口增加：`thirdParty`, `thirdPartyLabel`, `trustLevel`。

后端 `upsertProviderPreset` 保存这三个新字段。

### 3. 后端：offering 查询传递 third_party 信息

offering 查询已经 LEFT JOIN provider_presets。需要在查询结果中增加 preset 的 third_party 信息：

**文件**: `apps/platform-api/src/repositories/postgres-platform-repository.ts`

在 `findOfferingsForModel`、`findUserOfferingsForModel` 查询中增加：
```sql
COALESCE(p.third_party, false) AS "thirdParty",
p.third_party_label AS "thirdPartyLabel",
COALESCE(p.trust_level, 'high') AS "trustLevel"
```

**文件**: `packages/shared-types/src/api/offerings.ts`

CandidateOffering 增加：
```typescript
thirdParty?: boolean;
thirdPartyLabel?: string;
trustLevel?: 'high' | 'medium' | 'low';
```

### 4. 路由：resolveOfferings 过滤第三方

**文件**: `apps/platform-api/src/core/router.ts`

在 fallback 路径中增加 `!o.thirdParty` 过滤：
```typescript
// line 33, 37, 41 — 现有 filter
offerings = offerings.filter(o => o.executionMode !== "node" && !o.thirdParty);
```

第三方 offerings 只能通过用户主动加入连接池后使用。

### 5. Network API 返回第三方标识

**文件**: `apps/platform-api/src/routes/network.ts`

`/v1/network/models` 返回的模型数据中增加 `thirdParty`、`thirdPartyLabel`、`trustLevel`。

### 6. Marketplace 展示

**文件**: `apps/web/src/pages/ModelsPage.tsx`

平台模型区域中，按 thirdParty + trustLevel 区分卡片样式：

| 类型 | 卡片边框/背景 | Badge |
|------|--------------|-------|
| 官方供应 (默认) | 蓝色 `border-blue-500/20 bg-blue-500/5` | ☁️ 平台节点 |
| 第三方 · 高可信 | 青色 `border-teal-500/20 bg-teal-500/5` | 🏪 {thirdPartyLabel} |
| 第三方 · 中可信 | 橙色 `border-orange-500/20 bg-orange-500/5` | 🏪 {thirdPartyLabel} |
| 第三方 · 低可信 | 红色/灰色 `border-red-500/20 bg-red-500/5` | ⚠️ {thirdPartyLabel} |
| 分布式节点 | 紫色 `border-purple-500/20 bg-purple-500/5` | 🖥️ 分布式 |

第三方卡片不显示在默认区域，单独一个 section："第三方供应模型"，排在平台模型之后、分布式节点之前。

### 7. ModelDetailPage 展示

**文件**: `apps/web/src/pages/ModelDetailPage.tsx`

- 第三方模型详情页顶部增加提示 banner（橙色/对应信任等级色）：
  "该模型由第三方供应商 {thirdPartyLabel} 提供，非官方直连。"
- "加入我的模型" 按钮不变（复用已有 join/leave 逻辑）

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `infra/sql/postgres/019_third_party_flag.sql` | 新建 migration |
| `packages/shared-types/src/api/offerings.ts` | CandidateOffering +3 字段 |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | 查询增加 third_party 字段 |
| `apps/platform-api/src/core/router.ts` | resolveOfferings 过滤 |
| `apps/platform-api/src/routes/network.ts` | API 返回 thirdParty |
| `apps/platform-api/src/routes/admin.ts` | upsertProviderPreset 保存新字段 |
| `apps/web/src/pages/admin/ProvidersPage.tsx` | 管理员配置表单 |
| `apps/web/src/pages/ModelsPage.tsx` | marketplace 三色卡片 + 分区 |
| `apps/web/src/pages/ModelDetailPage.tsx` | 详情页 banner |
| `apps/web/src/lib/i18n.ts` | 翻译键 |

## 验证

1. 管理员在供应商预设页开启第三方标识 + 设置标识名称和可信度
2. 用户创建该预设的 offering → offering 继承 thirdParty 属性
3. marketplace 显示对应颜色卡片在单独的"第三方供应"区域
4. 未加入连接池的用户请求该模型 → 404
5. 用户从 marketplace 详情页加入 → 请求成功
6. 管理员关闭第三方标识 → offering 恢复为蓝色 + 自动可用
