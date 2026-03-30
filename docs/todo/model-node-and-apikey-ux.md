# 模型节点管理 + API Key 管理 UX 优化

> 设计文档 — 2026-03-30 v2

## 一、文案修改

| Key | 改前 | 改后 |
|-----|------|------|
| `modelsMgmt.addNew` | `+ 接入新模型` | `+ 创建模型节点` |
| 本地节点描述 | `在本地运行节点程序 直接提供模型服务` | `在本地运行节点程序 创建分布式模型节点` |

## 二、API Key 管理页面重构

### 2.1 页面布局

```
API Key 管理

━━━ 平台 API Key ━━━
使用 API Key 通过 OpenAI 兼容接口访问你已连接的模型

ID                    Key            状态   创建时间      操作
pak_d0f3a57b2104...   xk-…abc123     活跃   2026-03-28    删除

[名称输入框] [创建 API Key]  (3/5)

━━━ 模型节点 Key ━━━
模型节点连接上游模型服务使用的 Key

ID                    Key            供应商      状态   创建时间      操作
cred_938f...1daf      sk-ki…P9nq     Kimi Code   活跃   2026-03-28    测试  删除
  ▼ 展开
  支持的模型节点:
  - kimi-for-coding (运行中)    1500/3500 xt/1k
  - kimi-for-coding (已停用)    1500/3500 xt/1k

cred_d096...3fb25     sk-20…af9a     DeepSeek    失效   2026-03-27    测试  删除
```

### 2.2 Key Preview 字段

创建 credential 时，从明文 API Key 提取 preview 存入 DB：

```sql
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS api_key_preview TEXT;
```

Preview 格式：取前 5 字符 + `…` + 后 4 字符。例：`sk-ki…P9nq`

在 `createProviderCredential` 时计算并存储，后续 list 直接返回，不需要解密。

### 2.3 测试连通性

"测试"按钮调用 `POST /v1/provider-credentials/:id/test`（新增）

后端逻辑：
1. 解密 Key
2. 调用已有的 `validateProviderCredential()`
3. 返回结果 + 更新 credential 状态

状态映射：
| 测试结果 | credential 状态 | UI 显示 |
|----------|----------------|---------|
| 连通成功 | `active` | 绿色 "活跃" |
| 401/403 Key 失效 | `invalid` | 红色 "失效" |
| 403 配额用完 | `quota_exceeded` | 黄色 "配额用尽" |
| 网络错误/超时 | 不变 | 显示错误信息 |

### 2.4 删除 Key（级联停用）

用户点击"删除"模型节点 Key 时：

**确认弹窗：**
```
确定要删除此 Key 吗？

该 Key 关联的以下模型节点将被停用并移入历史记录：
  • kimi-for-coding (运行中)
  • kimi-for-coding (已停用)

此操作不可撤销。

[取消] [确认删除]
```

**后端操作：**
1. 所有关联 offerings：`enabled = false`, `archived_at = NOW()`, `archive_reason = 'key_deleted'`
2. Credential：`status = 'disabled'` + `encrypted_secret = NULL`（清除加密 Key，安全考虑）
3. 写 audit log

**保留策略：**
- Credential 记录保留（ID、provider_type、base_url、api_key_preview 等元数据）
- Offerings 记录保留（历史请求关联需要）
- 仅清除 `encrypted_secret`（用户可放心，Key 不再存储在平台）
- 历史记录永久保留，不可删除

### 2.5 平台 API Key 数量限制

- `platform_config` 新增 `max_api_keys_per_user = 5`
- 创建时后端检查，超限返回 403
- 前端显示 `(3/5)` 在创建按钮旁
- 管理员可在系统设置调整

## 三、节点管理"历史记录"

### 3.1 offerings 表新增字段

```sql
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS archive_reason TEXT;
```

`archive_reason` 值：
- `user_deleted` — 用户在节点管理里点"删除"
- `key_deleted` — 关联 Key 被删除
- `admin_stopped` — 管理员停用
- `auto_disabled` — 熔断器自动停用

### 3.2 节点管理页面分区

```
节点管理

━━━ 运行中 ━━━
kimi-for-coding  Kimi Code  1500/3500  [配置] [停用]

━━━ 历史记录 ━━━
                                                        操作时间
kimi-for-coding  Kimi Code  Key 已删除   2026-03-30 12:00
  [配置] [启用]  ← 全部灰色不可点击

deepseek-chat    DeepSeek   用户停用     2026-03-29 15:30
  [配置] [启用]  ← 灰色
```

### 3.3 节点"删除"按钮（实际是永久停用+归档）

在节点管理中，停止状态的 offering 显示"删除"按钮：

**确认弹窗：**
```
确定要删除此模型节点吗？

节点将被永久停用并移入历史记录。
历史请求记录和结算数据将保留。

[取消] [确认删除]
```

**操作：** `enabled = false`, `archived_at = NOW()`, `archive_reason = 'user_deleted'`

## 四、改动文件清单

| 改动 | 文件 |
|------|------|
| 文案 | `apps/web/src/lib/i18n.ts` |
| Key preview + archived_at migration | `infra/sql/postgres/018_key_preview_and_archive.sql` |
| Key preview 存储 | `apps/platform-api/src/repositories/postgres-platform-repository.ts` |
| Key 测试端点 | `apps/platform-api/src/routes/provider.ts` |
| Key 级联删除 | `apps/platform-api/src/routes/provider.ts` |
| Key 数量限制 | `apps/platform-api/src/routes/auth.ts` |
| credential 状态扩展 | `apps/platform-api/src/repositories/postgres-platform-repository.ts` |
| API Key 页面重写 | `apps/web/src/pages/app/ApiKeysPage.tsx` |
| 节点管理增加历史 | `apps/web/src/pages/app/ModelsManagePage.tsx` |
| 节点删除按钮 | `apps/web/src/pages/app/ModelsManagePage.tsx` |
| 管理员配置 | `apps/web/src/pages/admin/SettingsPage.tsx` |

## 五、实施顺序

| Step | 内容 |
|------|------|
| 1 | Migration: api_key_preview + archived_at + archive_reason + max_api_keys_per_user |
| 2 | 后端: Key preview 存储 + credential 状态扩展 + 测试端点 + 级联删除 + 数量限制 |
| 3 | 前端: 文案修改 |
| 4 | 前端: API Key 页面重写（平台 Key + 模型节点 Key 分区 + 展开详情） |
| 5 | 前端: 节点管理历史记录 + 删除按钮 |
| 6 | 测试 + E2E + PR + CI + 部署 |
