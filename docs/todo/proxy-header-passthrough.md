# 代理层 Header 透传与 Per-Provider 自定义配置

> 设计文档 — 2026-03-29

## 背景

### 问题

Kimi Coding API (`https://api.kimi.com/coding/v1`) 官方只允许 Claude Code、Roo Code、Kimi CLI 使用，可能通过检查 `User-Agent` 等 header 限制 agent 来源。

xllmapi 作为 API 代理，当前两条请求路径都**丢弃客户端原始 headers**，替换为固定值：

| 路径 | 场景 | 当前 User-Agent | 问题 |
|------|------|-----------------|------|
| `proxyApiRequest` (adapter) | API 代理 `/v1/chat/completions` | `xllmapi/1.0` | Kimi 可能拒绝 |
| `executeStreamingRequest` (core) | Chat 页面 + 内部对话 | `claude-code/1.0` | 不可配置 |
| node-cli executor | 分布式节点 | `claude-code/1.0` | 不可配置 |

### 更深层问题

不同模型厂商可能有不同的 header 要求，当前架构缺乏灵活的 header 配置能力。需要一个通用的解决方案。

## 设计

### 核心原则

1. **默认透明传输** — 客户端的 `User-Agent` 默认透传到上游 provider
2. **管理员可配置** — per-provider 的 header 策略，支持 force / fallback 模式
3. **Chat 页面适配** — 浏览器 UA 不适合直接透传时，使用配置的 fallback 值

### Header 解析优先级

```
客户端请求 header
       ↓
检查 offering.customHeaders 配置
       ↓
┌─────────────────────────────────────────────┐
│ 无配置 → 透明传输客户端 User-Agent           │
│                                             │
│ mode: "force"  → 强制使用配置值，忽略客户端   │
│ mode: "fallback" → 客户端没传则用配置值       │
└─────────────────────────────────────────────┘
       ↓
合并到上游请求 headers
```

### 数据模型

`provider_presets.custom_headers` 和 `provider_credentials.custom_headers` JSONB 字段结构：

```jsonc
{
  "headers": {
    "user-agent": {
      "value": "claude-code/1.0",    // 配置值，支持占位符
      "mode": "fallback"              // "force" | "fallback"
    }
  },
  "passthrough": true                 // 是否透传未配置的客户端 UA（默认 true）
}
```

### 占位符变量

| 占位符 | 解析为 |
|--------|--------|
| `$CLIENT_USER_AGENT` | 客户端请求的 User-Agent header 原始值 |

### Kimi Coding 配置示例

```json
{
  "headers": {
    "user-agent": { "value": "claude-code/1.0", "mode": "fallback" }
  },
  "passthrough": true
}
```

| 场景 | 客户端 UA | 发送到 Kimi 的 UA | 原因 |
|------|-----------|-------------------|------|
| Claude Code 用户 | `claude-code/1.0.23` | `claude-code/1.0.23` | 客户端有值，透传 |
| Roo Code 用户 | `roo-code/1.2.0` | `roo-code/1.2.0` | 客户端有值，透传 |
| Chat 页面 | `Mozilla/5.0...` | `claude-code/1.0` | 浏览器 UA 无意义，用 fallback |
| 无 UA | (无) | `claude-code/1.0` | 用 fallback |

### 透传范围

只透传 `User-Agent`，不透传 `Authorization`、`Content-Type`、`x-api-key` 等由代理层控制的 header。

## 改动清单

### Layer 1: 数据库 Migration

**新增** `infra/sql/postgres/014_custom_headers.sql`

```sql
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS custom_headers JSONB;
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS custom_headers JSONB;

UPDATE provider_presets
SET custom_headers = '{"headers":{"user-agent":{"value":"claude-code/1.0","mode":"fallback"}},"passthrough":true}'::jsonb
WHERE id = 'kimi-coding';
```

### Layer 2: Shared Types

**修改** `packages/shared-types/src/api/offerings.ts`

```typescript
// CandidateOffering 新增
customHeaders?: {
  headers?: Record<string, { value: string; mode: "force" | "fallback" }>;
  passthrough?: boolean;
};
```

### Layer 3: Core Provider Functions

**修改** `packages/core/src/providers/openai.ts` + `anthropic.ts`

4 个函数（`streamOpenAI`, `callOpenAI`, `streamAnthropic`, `callAnthropic`）各新增：
```typescript
extraHeaders?: Record<string, string>;
```
spread 到 fetch headers 末尾（覆盖默认值）。

### Layer 4: Provider Executor（核心逻辑）

**修改** `apps/platform-api/src/core/provider-executor.ts`

新增 `resolveUpstreamHeaders()`:
```typescript
function resolveUpstreamHeaders(
  adapterHeaders: Record<string, string>,
  offering: CandidateOffering,
  clientUserAgent?: string
): Record<string, string> {
  const headers = { ...adapterHeaders };
  const config = offering.customHeaders;

  if (!config) {
    if (clientUserAgent) headers["user-agent"] = clientUserAgent;
    return headers;
  }

  if (config.headers) {
    for (const [name, rule] of Object.entries(config.headers)) {
      const resolvedValue = rule.value === "$CLIENT_USER_AGENT"
        ? (clientUserAgent ?? "claude-code/1.0")
        : rule.value;

      if (rule.mode === "force") {
        headers[name] = resolvedValue;
      } else if (rule.mode === "fallback") {
        const clientValue = name === "user-agent" ? clientUserAgent : undefined;
        headers[name] = clientValue || resolvedValue;
      }
    }
  }

  if (config.passthrough !== false && clientUserAgent && !config.headers?.["user-agent"]) {
    headers["user-agent"] = clientUserAgent;
  }

  return headers;
}
```

`proxyApiRequest` 和 `executeStreamingRequest` 各新增 `clientUserAgent?: string` 参数。

### Layer 5: 路由层

**修改** `apps/platform-api/src/routes/api-proxy.ts` — 传递 `req.headers["user-agent"]`
**修改** `apps/platform-api/src/routes/chat.ts` — 同上

### Layer 6: Repository

**修改** `apps/platform-api/src/repositories/postgres-platform-repository.ts`
- Offering 查询加入 `c.custom_headers`
- Preset upsert 加入 `custom_headers`
- Credential 创建时从 preset 复制 `custom_headers`

### Layer 7: 管理员 UI

**修改** `apps/web/src/pages/admin/ProvidersPage.tsx`
- Preset 编辑表单新增 Custom Headers JSON 编辑器

**修改** `apps/platform-api/src/routes/admin.ts` + `services/platform-service.ts`
- Preset CRUD 端点支持 `customHeaders` 字段

### Layer 8: Node 执行路径

**修改** `apps/platform-api/src/core/node-connection-manager.ts` — 传递 extraHeaders
**修改** `apps/node-cli/src/executor.ts` — 使用传入的 extraHeaders

## 实施计划

### Step 1: 基础设施（DB + Types）
- 014 migration
- CandidateOffering 类型更新
- `npm run build` 通过

### Step 2: Core 层 extraHeaders
- openai.ts / anthropic.ts 4 个函数加 extraHeaders
- 添加单元测试
- `npm run build` + `npm run test` 通过

### Step 3: Provider Executor header 解析
- resolveUpstreamHeaders 函数
- proxyApiRequest + executeStreamingRequest 接入
- 添加 resolveUpstreamHeaders 单元测试
- `npm run build` + `npm run test` 通过

### Step 4: 路由层 + Repository
- api-proxy.ts / chat.ts 传递 clientUserAgent
- Repository 查询加入 custom_headers
- Credential 创建复制 custom_headers
- `npm run build` + `npm run test` 通过

### Step 5: 管理员 UI + Admin API
- ProvidersPage 表单新增 custom_headers
- admin.ts 端点支持 customHeaders
- `npm run build` 通过

### Step 6: Node 执行路径
- node-connection-manager + node-cli executor
- `npm run build` 通过

### Step 7: 集成测试 + E2E
- `npm run test:e2e:mvp` 通过
- 本地模拟 curl 验证透传
- 管理员后台验证 custom_headers 保存和生效

## 验证矩阵

| 测试场景 | 预期结果 |
|----------|----------|
| 无 custom_headers 的 provider + 有 UA 的请求 | 透传客户端 UA |
| 无 custom_headers 的 provider + 无 UA | 使用 adapter 默认 UA |
| fallback 模式 + 客户端有 UA | 使用客户端 UA |
| fallback 模式 + 客户端无 UA | 使用配置的 fallback 值 |
| force 模式 + 客户端有 UA | 使用配置值，忽略客户端 |
| force 模式 + 客户端无 UA | 使用配置值 |
| 占位符 `$CLIENT_USER_AGENT` | 解析为客户端 UA |
| Chat 页面 + kimi-coding (fallback) | 使用 `claude-code/1.0` |
| Claude Code + kimi-coding (fallback) | 透传 `claude-code/x.x.x` |
