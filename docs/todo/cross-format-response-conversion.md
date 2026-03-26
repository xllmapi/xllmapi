# 平台 API 格式适配 + Provider 配置化

## Context

两个关联问题需要一次性从架构上解决：

1. **跨格式响应未转换** — 统一端点 `/xllmapi/v1` 的请求体转换了，但响应直接透传，clientFormat ≠ targetFormat 时客户端解析失败
2. **Provider 预设硬编码** — 模型厂商、模型、baseUrl 全部 hardcode 在 `platform-service.ts`，新增/修改需要改代码重新部署

## 修改计划

### Part 1: Provider 预设配置化

**目标**：Provider 预设从代码搬到数据库 `platform_config` 表，管理员在后台可配。

#### 1.1 数据结构

```ts
type ProviderPreset = {
  id: string;                    // "deepseek", "minimax", "kimi", ...
  label: string;                 // 显示名
  providerType: string;          // "openai_compatible" | "openai" | "anthropic"
  baseUrl: string;               // OpenAI 格式端点
  anthropicBaseUrl?: string;     // Anthropic 格式端点（双格式支持）
  models: Array<{
    logicalModel: string;        // 平台模型名
    realModel: string;           // 厂商模型名
    contextLength?: number;      // 上下文长度
    maxOutputTokens?: number;    // 最大输出
  }>;
};
```

#### 1.2 存储

- `platform_config` 表新增 key: `provider_presets`
- value: JSON 字符串，包含所有 provider 预设
- 管理员通过 `/v1/admin/config` PUT 接口更新

#### 1.3 代码改动

**文件**：`apps/platform-api/src/services/platform-service.ts`

- 保留 `PROVIDER_PRESETS` 作为默认值（代码内置兜底）
- 启动时从 `platform_config` 读取覆盖
- `getProviderCatalog()` 优先返回数据库配置，fallback 到代码默认

**文件**：`apps/platform-api/src/routes/admin.ts`

- 新增管理端点：`GET /v1/admin/provider-presets` 和 `PUT /v1/admin/provider-presets`

#### 1.4 管理后台 UI（可选，后续）

在 admin 面板添加 Provider 预设管理页面。短期可通过 API 直接管理。

---

### Part 2: 跨格式响应转换

**目标**：当 clientFormat ≠ targetFormat 时，自动转换响应格式。

#### 2.1 新增文件 `core/adapters/response-converter.ts`

**非流式转换**：

```ts
export function convertJsonResponse(
  from: ApiFormatId,
  to: ApiFormatId,
  body: Record<string, unknown>
): Record<string, unknown>
```

- OpenAI → Anthropic: `{ choices, usage }` → `{ type: "message", content, usage }`
- Anthropic → OpenAI: 反向

**流式转换**（状态机）：

```ts
export function createStreamConverter(
  from: ApiFormatId,
  to: ApiFormatId
): { transform(chunk: string): string[]; flush(): string[] }
```

OpenAI chunk → Anthropic events：
- 首个 chunk → `message_start` + `content_block_start`
- delta.content chunks → `content_block_delta`
- finish_reason chunk → `content_block_stop` + `message_delta` + `message_stop`

Anthropic events → OpenAI chunks：
- `content_block_delta` → `chat.completion.chunk`
- `message_stop` → chunk with `finish_reason: "stop"`

#### 2.2 修改 resolveEndpoint() — 优先同格式直连

```ts
function resolveEndpoint(offering, clientFormat) {
  // 优先：provider 支持客户端格式 → 直接转发，零转换
  if (clientFormat === "anthropic" && (offering.anthropicBaseUrl || offering.providerType === "anthropic")) {
    return { targetFormat: "anthropic", baseUrl: offering.anthropicBaseUrl || offering.baseUrl };
  }
  if (clientFormat === "openai" && offering.providerType !== "anthropic") {
    return { targetFormat: "openai", baseUrl: offering.baseUrl };
  }

  // 次优：provider 不支持客户端格式 → 需要双向转换
  if (clientFormat === "anthropic") {
    return { targetFormat: "openai", baseUrl: offering.baseUrl };  // 走 OpenAI，需转换
  }
  return { targetFormat: "anthropic", baseUrl: offering.anthropicBaseUrl || offering.baseUrl };
}
```

#### 2.3 修改 provider-executor.ts 响应路径

只有 `clientFormat !== targetFormat` 时才转换，否则直接透传：

```ts
const needsConversion = params.clientFormat !== targetFormat;

// 流式
if (isStreaming) {
  const converter = needsConversion
    ? createStreamConverter(targetFormat, params.clientFormat)
    : null;

  // 转换时修正 content-type
  if (needsConversion) {
    respHeaders["content-type"] = params.clientFormat === "anthropic"
      ? "text/event-stream; charset=utf-8"
      : "text/event-stream; charset=utf-8";
  }

  nodeStream.on("data", (chunk) => {
    if (converter) {
      for (const line of converter.transform(chunk.toString())) {
        params.res.write(line);
      }
    } else {
      params.res.write(chunk);  // 同格式直接透传
    }
  });

  nodeStream.on("end", () => {
    if (converter) {
      for (const line of converter.flush()) params.res.write(line);
    }
    params.res.end();
  });
}

// 非流式
if (!isStreaming) {
  if (needsConversion) {
    const converted = convertJsonResponse(targetFormat, params.clientFormat, JSON.parse(bodyText));
    params.res.end(JSON.stringify(converted));
  } else {
    params.res.end(bodyText);  // 同格式直接透传
  }
}
```

#### 2.4 决策矩阵

| 客户端格式 | Provider 支持 | 行为 |
|-----------|--------------|------|
| OpenAI | OpenAI (baseUrl) | **直接转发** — 零转换 |
| OpenAI | Anthropic only | 请求转换 + **响应转换** |
| Anthropic | Anthropic (anthropicBaseUrl) | **直接转发** — 零转换 |
| Anthropic | OpenAI only | 请求转换 + **响应转换** |
| Anthropic | 两种都支持 | **直接走 anthropicBaseUrl** — 零转换 |
| OpenAI | 两种都支持 | **直接走 baseUrl** — 零转换 |

双向无感，用户不需要关心 provider 支持什么格式。

---

### Part 3: MiniMax anthropicBaseUrl

作为 Part 2 的补充，给 MiniMax 预设加 `anthropicBaseUrl: "https://api.minimaxi.com/anthropic"`。

这样 MiniMax 在 Anthropic 请求时直接走原生 Anthropic 端点（最优路径，无需格式转换），只有当 provider 没有对应格式端点时才走转换。

---

## 文件清单

| 文件 | 修改 |
|------|------|
| `core/adapters/response-converter.ts` | **新建** — 响应格式转换（JSON + SSE 流） |
| `core/provider-executor.ts` | 在响应路径插入转换逻辑 |
| `core/adapters/index.ts` | 导出新模块 |
| `services/platform-service.ts` | Provider 预设支持从 DB 读取；MiniMax 加 anthropicBaseUrl |
| `routes/admin.ts` | 新增 provider-presets 管理端点 |
| `infra/sql/postgres/012_provider_presets.sql` | 可选：专用表或复用 platform_config |

## 优先级

1. **P0**: 响应格式转换（Part 2）— 解决根本问题
2. **P0**: MiniMax anthropicBaseUrl（Part 3）— 最优路径，避免不必要的转换
3. **P1**: Provider 预设配置化（Part 1）— 运营便利性

## 验证

```bash
# 1. Anthropic SDK → DeepSeek (OpenAI provider)
curl https://api.xllmapi.com/xllmapi/v1/messages \
  -H "x-api-key: xk-xxx" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"deepseek-chat","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}'
# 应返回 Anthropic 格式响应

# 2. OpenAI SDK → Anthropic provider (如果有)
curl https://api.xllmapi.com/xllmapi/v1/chat/completions \
  -H "Authorization: Bearer xk-xxx" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"hi"}]}'
# 应返回 OpenAI 格式响应

# 3. 流式同理，加 "stream": true

# 4. OpenCode 用 @ai-sdk/anthropic 调 MiniMax
# 5. npm run test:platform-api
# 6. npm run test:e2e:mvp
```
