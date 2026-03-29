# 管理员请求详情增强

> 设计文档 — 2026-03-29

## 背景

当前管理员请求明细页 (`/admin/requests`) 只有列表视图，无法查看单条请求的详细信息（IP、来源标识、结算详情等）。

## 目标

1. 记录每条请求的上下文信息（客户端 IP、User-Agent、实际发送到供应商的 UA、API Key ID）
2. 管理员可点击请求行查看完整详情
3. 列表增加"来源"列显示客户端标识

## 数据库改动

**新增 migration** `infra/sql/postgres/015_request_context.sql`

`api_requests` 表新增 4 列：

```sql
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS client_ip TEXT;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS client_user_agent TEXT;      -- 客户端原始 UA
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS upstream_user_agent TEXT;    -- 实际发送到供应商的 UA
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS api_key_id TEXT;
```

### 双 UA 设计

| 字段 | 含义 | 示例 |
|------|------|------|
| `client_user_agent` | 客户端请求时带的原始 UA | `claude-code/1.0.23` / `Mozilla/5.0...` / 空 |
| `upstream_user_agent` | 经 resolveUpstreamHeaders 处理后实际发给供应商的 UA | `claude-code/1.0`（force 覆盖后）|

管理员可以对比两者，了解：
- 请求实际来自哪个客户端
- 发给供应商的是什么身份
- force/fallback 是否生效

## 后端改动

### 1. 录入时存储上下文

`SettlementParams` 新增字段：
```typescript
clientIp?: string;
clientUserAgent?: string;       // 客户端原始
upstreamUserAgent?: string;     // 实际发送到供应商
apiKeyId?: string;
```

录入来源：
- `chat.ts`：从 `req` 提取 IP/UA，从 `result.upstreamUserAgent` 获取 upstream UA
- `api-proxy.ts`：同上 + 从 `auth.apiKeyId` 获取 API key ID

`provider-executor.ts`：
- `proxyApiRequest` 返回值增加 `upstreamUserAgent`
- `ProviderResult` 增加 `upstreamUserAgent`

### 2. 请求详情 API

新增 `GET /v1/admin/requests/:id`

返回内容：
```typescript
{
  // 基本信息
  id, createdAt, status,
  // 请求者
  userName, userEmail, clientIp,
  // 来源
  clientUserAgent, upstreamUserAgent, apiKeyId,
  // 模型
  logicalModel, realModel, provider,
  // Token
  inputTokens, outputTokens, totalTokens,
  // 结算
  consumerCost, supplierReward, platformMargin,
  supplierRewardRate, settledAt,
  // 供应商
  chosenOfferingId, supplierUserId, supplierEmail,
  // 价格
  fixedPricePer1kInput, fixedPricePer1kOutput,
}
```

### 3. 列表查询增加 client_user_agent

用于列表"来源"列显示。

## 前端改动

### 列表增加"来源"列

从 `client_user_agent` 提取简称显示（如 `claude-code/1.0`），hover 显示完整 UA。

### 详情面板

点击行后展开内嵌详情面板，调用 `GET /v1/admin/requests/:id`。

| 分区 | 字段 |
|------|------|
| 基本信息 | 请求 ID、时间、状态 |
| 请求者 | 用户名、邮箱、IP |
| 来源 | 客户端 UA、实际发送 UA、API Key ID |
| 模型 | 逻辑模型、真实模型、供应商类型 |
| Token | 输入/输出/合计 |
| 结算 | 消费者扣费、供应商收入、平台收入、分成比例 |
| 供应商 | Offering ID、供应商用户 |

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `infra/sql/postgres/015_request_context.sql` | 新增 migration |
| `apps/platform-api/src/core/provider-executor.ts` | 返回 upstreamUserAgent |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | INSERT 加 4 列 + getRequestDetail + 列表加 UA |
| `apps/platform-api/src/repositories/platform-repository.ts` | 接口类型 |
| `apps/platform-api/src/services/platform-service.ts` | 透传新字段 |
| `apps/platform-api/src/routes/chat.ts` | 提取 IP/UA 传入 settlement |
| `apps/platform-api/src/routes/api-proxy.ts` | 提取 IP/UA/apiKeyId 传入 settlement |
| `apps/platform-api/src/routes/admin.ts` | 新增 GET /v1/admin/requests/:id |
| `apps/web/src/pages/admin/AdminRequestsPage.tsx` | 来源列 + 详情面板 |
| `apps/web/src/lib/i18n.ts` | 详情面板翻译 |
