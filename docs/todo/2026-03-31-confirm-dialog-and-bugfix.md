# 确认对话框 + 状态修复 + 按钮布局优化

> 设计文档 — 2026-03-31 v1
> 基于用户反馈对 model-node-and-apikey-ux.md 方案的补充修正

## 一、问题清单

| # | 类型 | 描述 |
|---|------|------|
| 1 | UI | credential 删除使用浏览器原生 `confirm()`，需替换为自定义确认弹窗 + 5s 倒计时 |
| 2 | UI | 节点"停用"使用浏览器原生 `confirm()`，同上 |
| 3 | Bug | 已删除 credential 状态显示"已停止"而非"已删除" |
| 4 | Bug | 对已删除 credential 点击测试仍显示"连接正常"（前端读取错误的响应字段） |
| 5 | UI | 节点管理中"停用"按钮应在"配置"和"启动"左侧 |

## 二、根因分析

### Bug #3: credential 删除后状态显示错误

cascade delete 设置 `status = 'disabled'`，前端 `credentialStatusBadge` 将 `disabled` 映射为"已停止"。
应当区分"用户主动停用"和"Key 被删除"两种状态。

**修复**：cascade delete 设置 `status = 'deleted'`，前端新增 `deleted` 状态映射为"已删除"。

### Bug #4: 测试已删除 credential 显示连接成功

**根因**：后端 `POST /v1/provider-credentials/:id/test` 返回：
```json
{ "ok": true, "requestId": "...", "data": { "ok": false, "status": "no_key", "message": "..." } }
```

前端 `ApiKeysPage.tsx:131` 检查 `res.ok !== false`，读到的是外层 HTTP 信封的 `ok: true`，而非内层测试结果的 `data.ok`。
因此**所有测试**（包括失败的）都显示"连接正常"。

**修复**：前端读取 `res.data.ok` 和 `res.data.message`。后端增加 `deleted` 状态防御检查。

## 三、实现方案

### 3.1 新建 ConfirmDialog 组件

`apps/web/src/components/ui/ConfirmDialog.tsx`

- 半透明遮罩 + 居中面板
- 标题 + 风险描述
- 取消按钮（始终可用）+ 确认按钮（倒计时期间禁用）
- 确认按钮文本："确认 (5s)" → "确认 (4s)" → ... → "确认"
- ESC 键关闭
- Props: `open`, `onConfirm`, `onCancel`, `title`, `description`, `countdown?`(默认5), `variant?`(danger/warning)

### 3.2 i18n 新增翻译键

| Key | zh | en |
|-----|----|----|
| `apiKeys.deleteKeyTitle` | 删除 Key | Delete Key |
| `apiKeys.deleteKeyWarning` | 此操作将永久删除此 Key，关联的模型节点将被停用并移入历史记录。此操作不可撤销。 | This will permanently delete this key. Associated model nodes will be stopped and moved to history. This action cannot be undone. |
| `apiKeys.statusDeleted` | 已删除 | Deleted |
| `modelsMgmt.stopNodeTitle` | 停用模型节点 | Stop Model Node |
| `modelsMgmt.stopNodeWarning` | 此操作将停用此模型节点并移入历史记录。此操作不可撤销。 | This will stop this model node and move it to history. This action cannot be undone. |
| `common.confirm` | 确认 | Confirm |

### 3.3 后端：credential cascade delete 状态改为 'deleted'

`postgres-platform-repository.ts:2102`:
```sql
-- 改前
UPDATE provider_credentials SET status = 'disabled', encrypted_secret = NULL
-- 改后
UPDATE provider_credentials SET status = 'deleted', encrypted_secret = NULL
```

### 3.4 后端：testProviderCredential 增加 deleted 状态防御

`platform-service.ts:900-924`:
- 在 `hasEncryptedSecret` 检查后增加 `if (cred.status === 'deleted') return { ok: false, ... }`
- 在状态更新处防止覆盖 deleted 状态

### 3.5 前端：修复 test 结果读取

`ApiKeysPage.tsx:127-135`:
- 修改响应类型，读取 `res.data.ok` 而非 `res.ok`

### 3.6 前端：credential 状态 badge 新增 deleted

`ApiKeysPage.tsx:154-167`:
- 新增 `case "deleted"` → 红色 Badge "已删除"

### 3.7 前端：credential 删除使用 ConfirmDialog

`ApiKeysPage.tsx`: 替换 `confirm()` 为 ConfirmDialog + 5s 倒计时

### 3.8 前端：节点停用使用 ConfirmDialog + 按钮重排

`ModelsManagePage.tsx`:
- 替换 `handleArchiveOffering` 中的 `confirm()` 为 ConfirmDialog + 5s 倒计时
- 按钮顺序从 [配置][启动/停止][停用] 改为 [停用][配置][启动/停止]

## 四、改动文件清单

| 文件 | 改动 |
|------|------|
| `apps/web/src/components/ui/ConfirmDialog.tsx` | 新建 |
| `apps/web/src/lib/i18n.ts` | 新增翻译键 |
| `apps/web/src/pages/app/ApiKeysPage.tsx` | 状态 badge + test 结果修复 + ConfirmDialog |
| `apps/web/src/pages/app/ModelsManagePage.tsx` | ConfirmDialog + 按钮重排 |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | cascade delete status='deleted' |
| `apps/platform-api/src/services/platform-service.ts` | test 防御 deleted 状态 |

## 五、验证计划

1. `npm run build` — 无 TypeScript 错误
2. `npm run test:platform-api` — 单元测试通过
3. 本地启动服务，验证：
   - credential 删除 → 自定义弹窗 + 5s 倒计时
   - 删除后状态显示"已删除"
   - 对已删除 credential 点测试 → 显示失败
   - 对正常 credential 点测试 → 仍显示"连接正常"
   - 节点"停用"按钮在左侧
   - 节点"停用"→ 自定义弹窗 + 5s 倒计时
