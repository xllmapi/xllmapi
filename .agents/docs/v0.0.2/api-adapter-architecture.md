# API 代理层：可扩展的多格式代理架构

## Context

xllmapi 平台需要：
- **用户侧**：同时暴露 OpenAI 和 Anthropic 两种 API 格式
- **Provider 侧**：同一 provider 可能有多种端点（如 MiniMax 有 OpenAI + Anthropic 两个端点）
- **架构**：从一开始就设计好扩展性，后续加 Gemini/Groq 等 provider 格式只需实现 adapter

### 当前问题

1. `/v1/messages` 不是透传，thinking block 丢失
2. credential 只有一个 `base_url`，不能存多端点
3. 没有格式转换能力（OpenAI → Anthropic 或反向）
4. provider 路由逻辑硬编码在 proxyApiRequest 里

## 架构设计

### 核心概念：ApiFormat + ProviderAdapter

```
用户请求 (OpenAI/Anthropic 格式)
       ↓
  API 路由层 (api-proxy.ts)
    - 认证、限流、钱包、offering 选择
    - 识别 clientFormat: "openai" | "anthropic"
       ↓
  代理引擎 (proxyApiRequest)
    - 选择 offering
    - 根据 offering 的可用端点和 clientFormat 决定路由策略：
      - 同格式透传（优先）
      - 跨格式转换（如果没有同格式端点）
       ↓
  Provider Adapter (格式转换层)
    - OpenAI adapter: 构建 /chat/completions 请求
    - Anthropic adapter: 构建 /messages 请求
    - 每种 adapter 负责：URL 构建、auth headers、body 转换、usage 提取
```

### Provider Adapter 接口

```typescript
// core/adapters/types.ts
interface ApiFormat {
  id: string;                    // "openai" | "anthropic" | "gemini" | ...
  contentType: string;           // "application/json"
  authStyle: "bearer" | "x-api-key" | "custom";
  streamFormat: "sse" | "ndjson";
}

interface ProviderAdapter {
  format: ApiFormat;

  /** 构建请求 URL */
  buildUrl(baseUrl: string): string;

  /** 构建 auth headers */
  buildHeaders(apiKey: string): Record<string, string>;

  /** 转换请求 body（从通用格式或从另一种格式） */
  transformRequest(body: Record<string, unknown>, model: string): Record<string, unknown>;

  /** 从 streaming tail buffer 提取 usage */
  extractUsageFromStream(tailBuffer: string): ProxyUsage | undefined;

  /** 从 non-streaming JSON 提取 usage */
  extractUsageFromJson(body: Record<string, unknown>): ProxyUsage | undefined;
}
```

### 格式转换器（可选，本次实现 OpenAI ↔ Anthropic）

```typescript
// core/adapters/converters.ts
interface FormatConverter {
  /** 转换请求 body */
  convertRequest(from: ApiFormat, to: ApiFormat, body: Record<string, unknown>): Record<string, unknown>;
  /** 转换 streaming chunk（不实现，跨格式时回退到 non-streaming 或 adapter 内部处理） */
}

// OpenAI → Anthropic: messages 格式转换、system 提取、max_tokens 映射
// Anthropic → OpenAI: content block 扁平化、thinking → content 合并
```

### 路由策略

```
proxyApiRequest 收到 (clientFormat, offerings):

1. 筛选 offering:
   - 优先：offering 有 clientFormat 对应的端点 → 同格式透传（最佳）
   - 其次：offering 有其他端点 + 格式转换器存在 → 转换后代理
   - 最后：都不满足 → 报错

2. 构建请求:
   adapter = getAdapter(targetFormat)  // 目标端点的格式
   url = adapter.buildUrl(baseUrl)
   headers = adapter.buildHeaders(apiKey)
   body = (clientFormat === targetFormat)
     ? rawBody                          // 同格式：原样透传
     : converter.convertRequest(...)     // 跨格式：转换

3. 发送 + pipe 响应
4. 提取 usage: adapter.extractUsageFromStream/Json
```

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `infra/sql/postgres/009_provider_endpoints.sql` | migration: 添加 `anthropic_base_url` |
| `packages/shared-types/src/api/offerings.ts` | CandidateOffering 加 `anthropicBaseUrl` |
| `apps/platform-api/src/core/adapters/types.ts` | **新建**: adapter 接口定义 |
| `apps/platform-api/src/core/adapters/openai.ts` | **新建**: OpenAI adapter |
| `apps/platform-api/src/core/adapters/anthropic.ts` | **新建**: Anthropic adapter |
| `apps/platform-api/src/core/adapters/converter.ts` | **新建**: OpenAI ↔ Anthropic 格式转换 |
| `apps/platform-api/src/core/adapters/index.ts` | **新建**: adapter registry |
| `apps/platform-api/src/core/provider-executor.ts` | proxyApiRequest 使用 adapter |
| `apps/platform-api/src/routes/api-proxy.ts` | `/v1/messages` 改用 proxyApiRequest |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | query 加 `anthropic_base_url` |

## 实施步骤

### 阶段 1: Adapter 基础设施
1. 创建 `core/adapters/types.ts` — 接口定义
2. 创建 `core/adapters/openai.ts` — OpenAI adapter（从 proxyApiRequest 提取现有逻辑）
3. 创建 `core/adapters/anthropic.ts` — Anthropic adapter
4. 创建 `core/adapters/index.ts` — adapter registry: `getAdapter(format)`

### 阶段 2: 数据层支持多端点
5. 创建 migration `009_provider_endpoints.sql`
6. 扩展 `CandidateOffering` 类型加 `anthropicBaseUrl`
7. 修改 repository 查询

### 阶段 3: 格式转换器
8. 创建 `core/adapters/converter.ts` — OpenAI ↔ Anthropic body 转换

### 阶段 4: 代理引擎集成
9. 重构 `proxyApiRequest` — 使用 adapter 做 URL/headers/usage 提取
10. 加入路由策略：同格式优先 → 跨格式转换

### 阶段 5: 路由层
11. 修改 `api-proxy.ts` `/v1/messages` — 传 `apiFormat: "anthropic"` 调 proxyApiRequest

### 阶段 6: 测试
12. 构建 + curl 测试所有矩阵组合
13. opencode + anthropic adapter 测试 MiniMax thinking

## 后续扩展

添加新 provider 格式（如 Gemini）只需：
1. 创建 `core/adapters/gemini.ts` 实现 `ProviderAdapter`
2. 在 `index.ts` registry 注册
3. DB 加 `gemini_base_url` 字段（如需要）
4. converter 加 OpenAI ↔ Gemini 转换

## Verification

1. `npm run build` 通过
2. curl `/v1/chat/completions` → OpenAI provider 透传正常
3. curl `/v1/messages` → Anthropic provider 透传正常（含 thinking block）
4. curl `/v1/messages` + MiniMax → 走 anthropic_base_url 端点，thinking 正确
5. curl `/v1/chat/completions` + Anthropic-only provider → 跨格式转换生效
6. opencode `@ai-sdk/anthropic` + xllmapi → MiniMax thinking UI 正确显示
7. token 统计正确（OpenAI + Anthropic 格式都能提取 usage）
8. 平台前端 chat 不受影响
9. 单元测试通过
