# 优化：连接管理 + 供应商选择列表同步第三方标识

## Context

管理员已可配置第三方供应商标识（thirdParty/trustLevel/label），marketplace 已正确显示颜色和 badge。但两处 UI 未同步：
1. **连接管理（UsingTab）**— 用户连接的模型卡片无第三方标识
2. **创建模型节点的供应商选择列表** — 无第三方颜色标识

## 改动

### 1. 后端：listConnectionPoolGrouped 增加 thirdParty 字段

**文件**: `apps/platform-api/src/repositories/postgres-platform-repository.ts` (listConnectionPoolGrouped)

当前查询只 JOIN offerings + api_requests，需要加 JOIN provider_credentials + provider_presets 获取 thirdParty 信息：

```sql
-- 新增字段
bool_or(COALESCE(p.third_party, false)) AS "thirdParty",
MAX(p.third_party_label) AS "thirdPartyLabel",
MAX(COALESCE(p.trust_level, 'high')) AS "trustLevel"

-- 新增 JOIN
LEFT JOIN provider_credentials c ON c.id = o.credential_id
LEFT JOIN provider_presets p ON (
  (p.base_url IS NOT NULL AND p.base_url != '' AND RTRIM(c.base_url, '/') LIKE RTRIM(p.base_url, '/') || '%')
  OR (p.anthropic_base_url IS NOT NULL AND p.anthropic_base_url != '' AND RTRIM(c.base_url, '/') LIKE RTRIM(p.anthropic_base_url, '/') || '%')
)
```

### 2. 后端：listProviderCatalog 增加 thirdParty 字段

**文件**: `apps/platform-api/src/services/platform-service.ts` (listProviderCatalog)

ProviderPreset type 增加 `thirdParty?`, `thirdPartyLabel?`, `trustLevel?`。
flat.push 时从 DB preset 传递这些字段。

### 3. 前端：UsingTab 卡片增加第三方 badge + 颜色

**文件**: `apps/web/src/pages/app/ModelsManagePage.tsx` (UsingTab)

PoolModelEntry 接口增加 `thirdParty?`, `thirdPartyLabel?`, `trustLevel?`。

模型卡片边框颜色按 trustLevel 区分（与 ModelsPage 一致）：
- 默认：`border-line`（现有）
- thirdParty + high：`border-teal-500/20`
- thirdParty + medium：`border-orange-500/20`
- thirdParty + low：`border-red-500/20`

模型名旁增加 badge（与 ModelsPage 一致）。

### 4. 前端：供应商选择列表增加第三方颜色标识

**文件**: `apps/web/src/pages/app/ModelsManagePage.tsx` (ProvidingTab 供应商选择)

ProviderPreset 接口增加 `thirdParty?`, `trustLevel?`。

供应商列表项按 trustLevel 显示左侧色条或文字标签。

## 改动文件

| 文件 | 改动 |
|------|------|
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | listConnectionPoolGrouped 加 thirdParty |
| `apps/platform-api/src/services/platform-service.ts` | ProviderPreset type + listProviderCatalog 传递 |
| `apps/web/src/pages/app/ModelsManagePage.tsx` | UsingTab 卡片 + 供应商列表颜色标识 |

### 5. 文案优化

**文件**: `apps/web/src/lib/i18n.ts`

- zh: `"该模型由第三方供应商提供，非官方API直连"` → `"该模型由第三方供应商平台API实现，非官方API直连"`
- en: `"This model is provided by a third-party supplier, not an official API direct connection"` → `"This model is powered by a third-party supplier platform API, not an official API direct connection"`

## 验证

1. `npm run build`
2. `npm run test:e2e:mvp`
3. 本地验证：连接管理中第三方模型（gpt-5.4）显示橙色边框 + badge
4. 本地验证：供应商选择列表中 OpenAI-AH 有颜色标识
5. 与 marketplace（ModelsPage）颜色一致
