# 分布式节点系统完整方案

## Context

xllmapi 分布式节点 CLI (`xllmapi-node`) 功能完整但存在两类问题：
1. **易用性**：默认连 localhost、无配置持久化、重启需重新输入所有配置
2. **安全性**：节点可以看到用户对话明文，开源代码中 JS 层加密无意义

方案分两阶段并行推进：
- Phase 1: 纯 TS 易用性改进（node-cli 改动，不改后端）
- Phase 2: Rust napi-rs 安全执行器（对话内容加密，明文不过 JS 堆）

---

## Phase 1: 易用性（纯 TypeScript，改 node-cli）

### 1.1 默认 URL + WSS 安全提示

**文件:** `apps/node-cli/src/main.ts:9`
```typescript
const DEFAULT_PLATFORM_URL = process.env.XLLMAPI_PLATFORM_URL || 'wss://xllmapi.com/ws/node';
```

**文件:** `apps/node-cli/src/ws-client.ts` connect() 开头
```typescript
if (url.startsWith('ws://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
  log.warn('WARNING: unencrypted ws:// to remote server, consider wss://');
}
```

### 1.2 配置持久化

**文件:** `apps/node-cli/src/config.ts` 新增：

```typescript
export interface SavedConfig {
  platformUrl: string;
  token: string;
  provider: { type: ProviderConfig['type']; baseUrl?: string; presetKey?: string; };
}

// ~/.config/xllmapi/node.json (0o600 权限，不含 API Key)
export function loadSavedConfig(): SavedConfig | null;
export function saveConfig(config: SavedConfig): void;
export function getConfigPath(): string;
```

**文件:** `apps/node-cli/src/main.ts` main() 流程：
1. `--setup` → 强制交互式重配
2. CLI 参数 → 直接使用
3. `~/.config/xllmapi/node.json` 存在 → 加载，API Key 从 `XLLMAPI_API_KEY` 环境变量或提示输入
4. 都没有 → 首次交互式设置，结束时询问保存

### 1.3 --help 更新

```
环境变量:
  XLLMAPI_PLATFORM_URL    平台地址 (默认 wss://xllmapi.com/ws/node)
  XLLMAPI_API_KEY          供应商 API Key
配置文件: ~/.config/xllmapi/node.json
  --setup    重新配置
```

---

## Phase 2: 安全执行器（Rust napi-rs）

### 架构

```
apps/node-cli/ (开源 TS)          packages/secure-executor/ (私有 Rust)
  main.ts — TUI/CLI                 lib.rs — napi-rs 导出
  ws-client.ts — WebSocket          crypto.rs — AES-256-GCM 解密
  discovery.ts — 模型发现            http_client.rs — reqwest 流式调用
  executor.ts — 调 Rust 模块         sse_parser.rs — SSE 解析
```

### 数据流

```
平台 dispatch():
  生成 AES key + iv → 加密 messages → WS 发送 {encryptedMessages, key, iv, model...}

节点 executor.ts:
  收到加密请求 → 传给 Rust: secureExecute({encryptedMessages, key, iv, providerUrl, apiKey, model})

Rust 内部:
  AES 解密 → messages (仅 Rust 堆) → reqwest POST LLM API → SSE 流 → callback onDelta → 返回结果
  messages drop，JS 堆中从未出现明文
```

### Rust 接口

```rust
#[napi]
pub async fn execute(
  params: ExecuteParams,                    // encrypted_messages, key, iv, provider config
  on_delta: ThreadsafeFunction<String>,     // 流式回调
) -> Result<ExecuteResult>                  // { content, usage, finish_reason }
```

### 平台侧加密

`node-connection-manager.ts` dispatch() 中用 `createCipheriv('aes-256-gcm')` 加密 messages，只发密文。

### 节点侧 graceful degradation

```typescript
let secureExecute = null;
try { secureExecute = require('@xllmapi/secure-executor').execute; }
catch { /* fallback to JS executor */ }

// 有 secure-executor → Rust 处理（安全）
// 没有 → JS 解密 fallback（降级但不拒绝服务）
// 未加密请求 → 走现有逻辑（兼容旧平台）
```

### 安全边界

**保护:** 标准节点中 messages 明文不过 JS 堆，日志不记录内容
**不保护:** 刻意篡改节点（截取 key+密文 / 逆向 Rust binary），但成本从"改一行 JS"升到"逆向 native binary"

### 向后兼容

- `platform_config.node_request_encryption` 控制是否加密
- 无 secure-executor 的老节点走未加密路径
- 新节点两种路径都支持

### 多平台 CI

GitHub Actions matrix: linux-x64, darwin-arm64, darwin-x64, win-x64
npm 发布预编译二进制，用户 `npm install` 自动拉对应平台

### 隐私标注 (UI)

NodeDetailPage.tsx 显示加密信息条，i18n 添加 `node.privacyInfo`

---

## 文件清单

### Phase 1
| 文件 | 改动 |
|------|------|
| `apps/node-cli/src/main.ts` | 默认 URL、配置加载/保存、--setup、--help |
| `apps/node-cli/src/config.ts` | SavedConfig、load/save 函数 |
| `apps/node-cli/src/ws-client.ts` | ws:// 警告 |

### Phase 2
| 文件 | 改动 |
|------|------|
| `packages/secure-executor/` | **NEW** Rust napi-rs crate |
| `apps/node-cli/src/executor.ts` | 对接 Rust 模块 |
| `apps/platform-api/src/core/node-connection-manager.ts` | dispatch() 加密 |
| `packages/shared-types/src/protocol/messages.ts` | 加密字段类型 |
| `apps/web/src/pages/NodeDetailPage.tsx` | 隐私标注 |
| `apps/web/src/lib/i18n.ts` | node.privacyInfo |
| `.github/workflows/build-secure-executor.yml` | **NEW** 多平台 CI |
