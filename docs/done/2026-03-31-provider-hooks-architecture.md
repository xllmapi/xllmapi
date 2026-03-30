# 架构方案：Provider 特化机制（Provider Hooks）

## Context

多次遇到特定厂商的非标准行为需要特殊处理：
- **Kimi**: OpenAI 端点返回 Anthropic 格式 SSE → 加了 autoDetect
- **Kimi Coding**: 要求特定 User-Agent → 加了 customHeaders
- **MiMo**: Anthropic 流式 `message_start.input_tokens=0`，真实值在 `message_delta` → 需要修改 adapter

当前架构问题：adapter 是按**格式**注册的（openai/anthropic），不是按**厂商**注册的。每次遇到厂商差异，要么改通用 adapter（影响所有厂商），要么在 provider-executor 里加 if/else（不可维护）。

**目标**：设计一个 Provider Hooks 机制，让特定厂商可以覆盖 adapter 的某些方法，而不影响通用逻辑。

## 设计方案：Provider Hooks + Adapter 组合

### 核心思路

在 `getAdapter(formatId)` 的基础上增加 `getAdapterForProvider(formatId, providerLabel)`，返回一个组合了 provider hooks 的 adapter。hooks 只覆盖需要特化的方法，其他方法 fallback 到基础 adapter。

### 新增类型

**文件**: `apps/platform-api/src/core/adapters/types.ts`

```typescript
/** Provider-specific hooks that override base adapter behavior */
export interface ProviderHooks {
  /** Override usage extraction from SSE stream */
  extractUsageFromStream?: (tail: string) => ProxyUsage | undefined;
  /** Override usage extraction from JSON response */
  extractUsageFromJson?: (body: unknown) => ProxyUsage | undefined;
  /** Transform request body before sending (after base prepareBody) */
  transformBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  /** Override URL building */
  buildUrl?: (baseUrl: string) => string;
}
```

只暴露 4 个 hook，覆盖已知的差异类型。不过度设计。

### Hook 注册

**文件**: `apps/platform-api/src/core/adapters/index.ts`

```typescript
// Provider hooks registry: keyed by provider label (lowercase)
const providerHooks = new Map<string, { openai?: ProviderHooks; anthropic?: ProviderHooks }>();

export function registerProviderHooks(
  providerLabel: string,
  hooks: { openai?: ProviderHooks; anthropic?: ProviderHooks }
): void {
  providerHooks.set(providerLabel.toLowerCase(), hooks);
}

/** Get adapter with provider-specific hooks applied */
export function getAdapterForProvider(
  formatId: ApiFormatId,
  providerLabel?: string
): ProviderAdapter {
  const base = getAdapter(formatId);
  if (!providerLabel) return base;

  const hooks = providerHooks.get(providerLabel.toLowerCase())?.[formatId];
  if (!hooks) return base;

  // Return a composed adapter that uses hooks where available, base otherwise
  return {
    formatId: base.formatId,
    buildUrl: hooks.buildUrl ?? base.buildUrl.bind(base),
    buildHeaders: base.buildHeaders.bind(base),
    prepareBody: hooks.transformBody
      ? (body, realModel) => hooks.transformBody!(base.prepareBody(body, realModel))
      : base.prepareBody.bind(base),
    extractUsageFromStream: hooks.extractUsageFromStream ?? base.extractUsageFromStream.bind(base),
    extractUsageFromJson: hooks.extractUsageFromJson ?? base.extractUsageFromJson.bind(base),
  };
}
```

### MiMo Hooks 实现

**新建文件**: `apps/platform-api/src/core/adapters/providers/mimo.ts`

```typescript
import type { ProviderHooks, ProxyUsage } from "../types.js";

/** MiMo Anthropic streaming: input_tokens in message_delta, not message_start */
export const mimoAnthropicHooks: ProviderHooks = {
  extractUsageFromStream(tail: string): ProxyUsage | undefined {
    const lines = tail.split("\n");
    let inputTokens = 0;
    let outputTokens = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.type === "message_start" && parsed.message?.usage) {
          const u = parsed.message.usage;
          const v = u.input_tokens || u.prompt_tokens || ((u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)) || 0;
          if (v > inputTokens) inputTokens = v;
        }
        if (parsed.type === "message_delta" && parsed.usage) {
          outputTokens = parsed.usage.output_tokens ?? 0;
          // MiMo: message_delta also carries input_tokens
          const deltaInput = parsed.usage.input_tokens || ((parsed.usage.cache_read_input_tokens ?? 0) + (parsed.usage.cache_creation_input_tokens ?? 0)) || 0;
          if (deltaInput > inputTokens) inputTokens = deltaInput;
        }
      } catch { /* skip */ }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
    }
    return undefined;
  },
};
```

### Hook 注册入口

**文件**: `apps/platform-api/src/core/adapters/providers/index.ts`

```typescript
import { registerProviderHooks } from "../index.js";
import { mimoAnthropicHooks } from "./mimo.js";

export function registerAllProviderHooks(): void {
  registerProviderHooks("MiMo", { anthropic: mimoAnthropicHooks });
  // 未来: registerProviderHooks("Kimi Coding", { openai: kimiHooks });
}
```

### provider-executor 集成

**文件**: `apps/platform-api/src/core/provider-executor.ts` line 265

```diff
- const adapter = getAdapter(targetFormat);
+ const adapter = getAdapterForProvider(targetFormat, offering.providerLabel);
```

只改一行。`providerLabel` 已经在 `CandidateOffering` 上可用。

### 启动时注册

**文件**: `apps/platform-api/src/main.ts`（或合适的初始化位置）

```typescript
import { registerAllProviderHooks } from "./core/adapters/providers/index.js";
registerAllProviderHooks();
```

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `apps/platform-api/src/core/adapters/types.ts` | 新增 `ProviderHooks` 接口 |
| `apps/platform-api/src/core/adapters/index.ts` | 新增 `providerHooks` registry + `getAdapterForProvider()` |
| `apps/platform-api/src/core/adapters/providers/mimo.ts` | 新建，MiMo Anthropic 流式 usage hook |
| `apps/platform-api/src/core/adapters/providers/index.ts` | 新建，注册所有 provider hooks |
| `apps/platform-api/src/core/provider-executor.ts` | `getAdapter()` → `getAdapterForProvider()` (1行) |
| `apps/platform-api/src/main.ts` | 调用 `registerAllProviderHooks()` |

## 设计原则

1. **最小改动**：provider-executor 只改一行，hooks 是可选的
2. **零影响**：没有注册 hooks 的厂商完全走原有逻辑
3. **易扩展**：新厂商只需新建一个文件 + 注册一行
4. **可测试**：hooks 是纯函数，可独立单测
5. **不改通用 adapter**：MiMo 的特殊行为隔离在 `providers/mimo.ts`

## 验证

1. `npm run build`
2. `npm run test:platform-api`
3. 部署后用 MiMo Anthropic 流式请求验证 input_tokens 不再为 0
4. 验证其他厂商（DeepSeek、Kimi）不受影响
