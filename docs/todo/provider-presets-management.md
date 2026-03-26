# Provider 预设管理 — 供应商管理页面改造

## Context

当前供应商管理页面按 `provider_type`（openai_compatible/openai/anthropic）分组，所有 DeepSeek、MiniMax、Kimi 都混在 "openai_compatible" 下。需要：

1. 按实际厂商（DeepSeek、MiniMax、Kimi 等）分组显示
2. 管理员可在供应商管理页面配置 Provider 预设（厂商、模型、baseUrl、anthropicBaseUrl）
3. 不再 hardcode 在代码里

## 方案

### 数据库

新增 `provider_presets` 表（migration 012）：

```sql
CREATE TABLE IF NOT EXISTS provider_presets (
  id TEXT PRIMARY KEY,                    -- "deepseek", "minimax", "kimi", ...
  label TEXT NOT NULL,                    -- "DeepSeek", "MiniMax", "Kimi / Moonshot"
  provider_type TEXT NOT NULL,            -- "openai_compatible" | "openai" | "anthropic"
  base_url TEXT NOT NULL,                 -- OpenAI 格式端点
  anthropic_base_url TEXT,                -- Anthropic 格式端点（双格式支持）
  models JSONB NOT NULL DEFAULT '[]',     -- [{logicalModel, realModel, contextLength, maxOutputTokens}]
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- 插入默认预设（从代码迁移）
INSERT INTO provider_presets (id, label, provider_type, base_url, anthropic_base_url, models, sort_order) VALUES
('deepseek', 'DeepSeek', 'openai_compatible', 'https://api.deepseek.com', NULL, '[{"logicalModel":"deepseek-chat","realModel":"deepseek-chat","contextLength":128000,"maxOutputTokens":8192},{"logicalModel":"deepseek-reasoner","realModel":"deepseek-reasoner","contextLength":128000,"maxOutputTokens":64000}]', 1),
('minimax', 'MiniMax', 'openai_compatible', 'https://api.minimaxi.com/v1', 'https://api.minimaxi.com/anthropic', '[{"logicalModel":"MiniMax-M2.7","realModel":"MiniMax-M2.7","contextLength":204800,"maxOutputTokens":16000},{"logicalModel":"MiniMax-M2.5","realModel":"MiniMax-M2.5","contextLength":204800,"maxOutputTokens":16000}]', 2),
('kimi-coding', 'Kimi Coding', 'openai_compatible', 'https://api.kimi.com/coding/v1', NULL, '[{"logicalModel":"kimi-for-coding","realModel":"kimi-for-coding","contextLength":256000,"maxOutputTokens":8192}]', 3),
('kimi', 'Kimi / Moonshot', 'openai_compatible', 'https://api.moonshot.ai/v1', NULL, '[{"logicalModel":"moonshot-v1-8k","realModel":"moonshot-v1-8k","contextLength":8000,"maxOutputTokens":4096},{"logicalModel":"moonshot-v1-32k","realModel":"moonshot-v1-32k","contextLength":32000,"maxOutputTokens":4096}]', 4),
('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', NULL, '[{"logicalModel":"gpt-4o","realModel":"gpt-4o","contextLength":128000,"maxOutputTokens":16384},{"logicalModel":"gpt-4o-mini","realModel":"gpt-4o-mini","contextLength":128000,"maxOutputTokens":16384}]', 5),
('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com/v1', NULL, '[{"logicalModel":"claude-sonnet-4-20250514","realModel":"claude-sonnet-4-20250514","contextLength":200000,"maxOutputTokens":8192}]', 6)
ON CONFLICT (id) DO NOTHING;
```

### 后端 API

在 `routes/admin.ts` 新增：

- `GET /v1/admin/provider-presets` — 列出所有预设
- `PUT /v1/admin/provider-presets/:id` — 更新预设（label、baseUrl、anthropicBaseUrl、models、enabled）
- `POST /v1/admin/provider-presets` — 新增预设
- `DELETE /v1/admin/provider-presets/:id` — 删除预设

### platform-service.ts 改造

- `getProviderCatalog()` 从 `provider_presets` 表读取，代码中的 `PROVIDER_PRESETS` 作为 fallback
- 用户创建 credential 时，根据选择的 preset 自动填充 baseUrl、anthropicBaseUrl

### 供应商管理页面改造

`apps/web/src/pages/admin/ProvidersPage.tsx`：

**当前**：按 provider_type 分组的简单表格
**改为**：两个 Tab

**Tab 1: 供应商预设**（新）
- 按厂商展示卡片/表格：DeepSeek、MiniMax、Kimi、OpenAI、Anthropic
- 每个厂商显示：名称、支持的格式（OpenAI/Anthropic/两者）、模型列表、状态
- 可编辑：baseUrl、anthropicBaseUrl、模型列表、启用/禁用
- 可新增/删除厂商

**Tab 2: 运行状态**（当前内容）
- 保留现有的按 provider_type 统计的节点数/请求数视图

### 文件清单

| 文件 | 修改 |
|------|------|
| `infra/sql/postgres/012_provider_presets.sql` | **新建** — 预设表 + 默认数据 |
| `repositories/postgres-platform-repository.ts` | 新增 CRUD 方法 |
| `repositories/platform-repository.ts` | 接口更新 |
| `routes/admin.ts` | 新增 4 个端点 |
| `services/platform-service.ts` | `getProviderCatalog()` 从 DB 读取 |
| `apps/web/src/pages/admin/ProvidersPage.tsx` | 改造为 Tab 布局 + 预设管理 |
| `apps/web/src/lib/i18n.ts` | 新增 i18n key |

### 验证

1. 管理后台供应商页面能看到所有厂商预设
2. 可编辑 MiniMax 的 anthropicBaseUrl
3. 可新增/删除厂商
4. 用户创建 offering 时能选择到更新后的预设
5. 构建通过、E2E 通过
