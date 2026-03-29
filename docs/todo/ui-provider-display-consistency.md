# UI 显示一致性优化方案

> 审计报告 + 优化方案 — 2026-03-29

## 一、问题根源

项目中 **"供应商"** 这个概念混淆了两层含义：

| 概念 | 存储 | 值示例 | 语义 |
|------|------|--------|------|
| **Provider Type**（协议类型） | `api_requests.provider`、`provider_credentials.provider_type` | `openai_compatible`、`openai`、`anthropic` | API 对接协议 |
| **Provider Label**（供应商名称） | `provider_presets.label` | `DeepSeek`、`Kimi Coding`、`OpenAI`、`MiniMax` | 真实服务商 |

`api_requests.provider` 存的是协议类型，但 UI 直接当供应商名称显示，导致用户看到 `openai_compatible` 这种技术标识。

---

## 二、用户视角审计

### 用户可见页面

| 页面 | 路径 | 显示的 provider 信息 | 问题 |
|------|------|---------------------|------|
| 模型市场 | `/models` | 无直接 provider 显示 | 无 |
| 模型详情 | `/models/:id` | 供应商名/handle | 正确 |
| Chat 页面 | `/chat` | 仅模型名 | 无 |
| 用户总览 | `/overview` | `provider` 列显示原始值 | `openai_compatible` 暴露给用户 |
| 我的模型管理 | `/models/manage` | `providerType` 显示原始值 | `openai_compatible` 暴露给用户 |
| 节点详情 | `/nodes/:id` | 无 provider 显示 | 无 |
| API Keys | `/api-keys` | 无 provider 信息 | 无 |

**用户视角核心问题：**
1. **用户总览页** — 消费/供给记录表的"供应商"列显示 `openai_compatible` 原始值
2. **我的模型管理页** — offering 的 provider 类型显示原始枚举值

### 管理员可见页面

| 页面 | 路径 | 显示的 provider 信息 | 问题 |
|------|------|---------------------|------|
| 管理总览 | `/admin/overview` | 最近请求表 `provider` 原始值 + 供应商状态 `providerType` 原始值 | 2 处原始值 |
| 请求明细 | `/admin/requests` | 已移除列表供应商列；详情面板 `provider` 原始值 | 详情面板 1 处 |
| 模型审核 | `/admin/reviews` | `providerType` 原始值或"平台节点" | 1 处原始值 |
| 供应商管理 | `/admin/providers` | `formatProviderType()` 格式化 | **唯一正确**的页面 |
| 结算记录 | `/admin/settlements` | 无 provider 显示 | 无 |
| 平台用量 | `/admin/usage` | 无 provider 显示 | 可以考虑增加 |
| 系统设置 | `/admin/settings` | 无 provider 信息 | 无 |

**管理员视角核心问题：**
1. 已有 `formatProviderType()` 函数但只在 1 个页面使用
2. 管理员看到 `openai_compatible` 无法直观关联到具体供应商（DeepSeek? Kimi? MiniMax?）
3. 详情面板显示的是协议类型而非供应商名称

---

## 三、改进层级

### Level 1: 格式化已有数据（短期，改 UI 层）

将 `formatProviderType()` 提取到公共 utils，所有页面统一调用。

**映射：**
| 原始值 | 中文 | 英文 |
|--------|------|------|
| `openai_compatible` | OpenAI 兼容 | OpenAI Compatible |
| `openai` | OpenAI | OpenAI |
| `anthropic` | Anthropic | Anthropic |

**改动页面（5 处）：**
1. `apps/web/src/pages/app/OverviewPage.tsx` — 消费/供给表
2. `apps/web/src/pages/app/ModelsManagePage.tsx` — offering provider badge
3. `apps/web/src/pages/admin/AdminOverviewPage.tsx` — 最近请求 + 供应商状态（2 处）
4. `apps/web/src/pages/admin/AdminRequestsPage.tsx` — 详情面板
5. `apps/web/src/pages/admin/ReviewsPage.tsx` — 审核列表

### Level 2: 存储并显示供应商名称（中期，改数据层）

在 `api_requests` 表新增 `provider_label` 列，录入时从 offering → credential → preset 链路取 label。

**效果：** 管理员请求详情从显示 `OpenAI 兼容` 提升到显示 `Kimi Coding` / `DeepSeek` 这样的真实供应商名称。

**改动：**
- 新增 DB migration：`ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS provider_label TEXT`
- `CandidateOffering` 类型加 `providerLabel?: string`
- 录入时写入 provider_label
- 前端详情面板优先显示 provider_label，fallback 到 formatProviderType

### Level 3: 统一供应商标识体系（长期）

设计一套供应商标识卡片，包含：
- 图标/颜色标识
- 供应商名称
- 协议类型 badge
- 在 offering 列表、请求记录、结算报告中统一使用

---

## 四、Level 1 详细方案

### 4.1 提取公共格式化函数

从 `ProvidersPage.tsx` 移到 `apps/web/src/lib/utils.ts`：

```typescript
export function formatProviderType(type: string): string {
  switch (type) {
    case "openai_compatible": return "OpenAI Compatible";
    case "openai": return "OpenAI";
    case "anthropic": return "Anthropic";
    default: return type;
  }
}
```

不使用 i18n（provider type 是英文技术术语，中英文都用同一个名称更合适）。

### 4.2 各页面改动

| 文件 | 位置 | 改动 |
|------|------|------|
| `apps/web/src/lib/utils.ts` | 新增 | 添加 `formatProviderType()` |
| `apps/web/src/pages/app/OverviewPage.tsx` | 消费/供给表 provider 列 | 调用 `formatProviderType(r.provider)` |
| `apps/web/src/pages/app/ModelsManagePage.tsx` | offering providerType badge | 调用 `formatProviderType(o.providerType)` |
| `apps/web/src/pages/admin/AdminOverviewPage.tsx` | 最近请求 + 供应商状态 | 调用 `formatProviderType()` |
| `apps/web/src/pages/admin/AdminRequestsPage.tsx` | 详情面板供应商行 | 调用 `formatProviderType(detail.provider)` |
| `apps/web/src/pages/admin/ReviewsPage.tsx` | 审核列表 providerType | 调用 `formatProviderType(o.providerType)` |
| `apps/web/src/pages/admin/ProvidersPage.tsx` | 已有 `formatProviderType` | 改为 import 公共函数 |

### 4.3 Level 2 额外改动

| 文件 | 改动 |
|------|------|
| `infra/sql/postgres/016_provider_label.sql` | `ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS provider_label TEXT` |
| `packages/shared-types/src/api/offerings.ts` | `CandidateOffering` 加 `providerLabel?: string` |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | offering 查询 JOIN preset 取 label；INSERT 写入 provider_label |
| `apps/web/src/pages/admin/AdminRequestsPage.tsx` | 详情面板优先显示 `detail.providerLabel`，fallback `formatProviderType(detail.provider)` |

---

## 五、其他 UI 显示建议

### 5.1 Tokens 单位标注

已实现：详情面板显示 `8 tokens`、`155 xt`、`1000 xt/1k tokens`。

### 5.2 Real Model 显示策略

当前不一致：`ModelsManagePage` 显示 `logicalModel → realModel` 映射，其他页面隐藏。

**建议：** 保持现状——realModel 只在管理/配置场景显示（模型管理页、请求详情面板），不在用户消费视图显示。

### 5.3 Execution Mode 标签

当前表现良好：用 emoji badge 区分平台节点和分布式节点。保持不变。

### 5.4 ID 显示策略

当前：Offering ID、Request ID 等使用 monospace 完整显示。

**建议：** 列表中截断显示前 8 位 + tooltip 完整值，详情面板保持完整显示。
