# 项目代码与测试集覆盖分析报告 + 完善方案

## 一、项目代码全景

### 1.1 模块总览

| 层级 | 模块 | 文件数 | 核心功能 |
|------|------|--------|----------|
| **路由层** | `src/routes/` | 12 | auth, chat, api-proxy, provider, usage, network, market, node, admin, public, notification |
| **核心层** | `src/core/` | 8 | router, provider-executor, circuit-breaker, context-affinity, offering-queue, node-connection-manager, adapters(converter, response-converter, openai, anthropic) |
| **服务层** | `src/services/` | 1 | platform-service (业务逻辑编排) |
| **数据层** | `src/repositories/` | 2 | postgres-platform-repository, platform-repository(接口) |
| **基础设施** | `src/lib/` + `src/` | 6 | errors, http, logger, crypto-utils, cache, rate-limit, middleware/security, metrics |
| **共享包** | `packages/core/` | 6 | circuit-breaker, retry, concurrency-limiter, sse-parser, context-manager, strip-thinking |

### 1.2 API 端点统计

| 模块 | 端点数 | 认证方式 |
|------|--------|----------|
| auth | 11 | 无/Session |
| user | 9 | Session |
| chat | 6 | Session |
| api-proxy | 8 | API Key/Session |
| provider | 12 | API Key |
| usage | 8 | Session |
| network | 7 | 无/API Key |
| market | 20 | 无/Session |
| node | 9 | Session |
| admin | 30+ | Admin Session |
| public | 4 | 无 |
| notification | 3 | Session |
| **合计** | **~127** | |

---

## 二、现有测试集覆盖分析

### 2.1 测试文件清单

| # | 测试文件 | 测试数 | 覆盖模块 | 类型 |
|---|---------|--------|----------|------|
| 1 | `error-classification.test.ts` | 7 | provider-executor.classifyError | 单元 |
| 2 | `resolve-upstream-headers.test.ts` | 13 | provider-executor.resolveUpstreamHeaders | 单元 |
| 3 | `response-converter.test.ts` | 7 | adapters/response-converter | 单元 |
| 4 | `router.test.ts` | 9 | context-affinity, offering-queue | 单元 |
| 5 | `router-resolve.test.ts` | 7 | router.resolveOfferings, routeRequest | 单元 |
| 6 | `cache-and-rate-limit.test.ts` | 2 | cache, rate-limit | 单元 |
| 7 | `password-hash.test.ts` | 2 | crypto-utils | 单元 |
| 8 | `http-security-and-metrics.test.ts` | 4 | http, security, metrics | 单元 |
| 9 | `models-endpoint.test.ts` | 6 | network routes (/v1/models) | 集成 |
| 10 | `server-integration.test.ts` | 8 | auth, admin, session, settlement | 集成 |
| 11 | `circuit-breaker.test.ts` (packages/core) | 15 | circuit-breaker 状态机 | 单元 |
| | **单元测试合计** | **~80** | | |
| 12 | `e2e-mvp-flow.mjs` | 60 assertions | 15 个用户旅程 | E2E |
| 13 | `e2e-sharing-flow.mjs` | ~20 assertions | 供应商/消费者工作流 | E2E |
| | **总计** | **~160** | | |

### 2.2 覆盖率矩阵（按模块）

| 模块 | 纯函数 | 状态逻辑 | 已有测试 | 覆盖度 | 优先级 |
|------|--------|---------|---------|--------|--------|
| **circuit-breaker** | ✓ | ✓状态机 | 15 tests | ██████████ 95% | ✅ 已完善 |
| **error-classification** | ✓ | — | 7 tests | ████████░░ 80% | 低 |
| **resolve-upstream-headers** | ✓ | — | 13 tests | ████████░░ 80% | 低 |
| **response-converter** | ✓ | ✓流状态 | 7 tests | ██████░░░░ 60% | 中 |
| **context-affinity** | ✓ | ✓内存Map | 5 tests | █████░░░░░ 50% | 中 |
| **offering-queue** | ✓ | ✓队列 | 5 tests | █████░░░░░ 50% | 中 |
| **router (resolve/route)** | ✓ | ✓亲和 | 7 tests | █████░░░░░ 50% | 高 |
| **crypto-utils** | ✓ | — | 2 tests | ███░░░░░░░ 30% | 中 |
| **cache + rate-limit** | ✓ | ✓桶/TTL | 2 tests | ██░░░░░░░░ 20% | 高 |
| **request-converter** | ✓ | — | 0 tests | ░░░░░░░░░░ 0% | 高 |
| **provider adapters** | ✓ | — | 0 tests | ░░░░░░░░░░ 0% | 高 |
| **context-manager** | ✓ | — | 0 tests | ░░░░░░░░░░ 0% | 中 |
| **strip-thinking** | ✓ | — | 0 tests | ░░░░░░░░░░ 0% | 低 |
| **retry** | ✓ | — | 0 tests | ░░░░░░░░░░ 0% | 中 |
| **concurrency-limiter** | ✓ | ✓信号量 | 0 tests | ░░░░░░░░░░ 0% | 中 |
| **http (token/IP解析)** | ✓ | — | 部分 | ███░░░░░░░ 30% | 中 |
| **provider-executor (代理)** | — | ✓流/重试 | 0 tests | ░░░░░░░░░░ 0% | 高 (需mock) |
| **settlement** | — | ✓ | E2E only | ███░░░░░░░ 30% | 高 (需mock) |

### 2.3 关键缺口总结

#### 零覆盖的重要模块
1. **request-converter** (`converter.ts`) — OpenAI↔Anthropic 请求格式转换，纯函数，容易测试
2. **provider adapters** (`openai.ts`, `anthropic.ts`) — URL 构建、Header 构建、Usage 提取
3. **context-manager** — 上下文窗口裁剪算法、token 估算
4. **retry** — 指数退避、可重试错误判断
5. **concurrency-limiter** — 并发信号量
6. **strip-thinking** — `<think>` 标签剥离

#### 覆盖不足的模块
1. **cache + rate-limit** — 仅 2 个测试，缺 TTL 过期、窗口重置、并发竞态
2. **crypto-utils** — 仅 2 个测试，缺加密/解密往返、空密码、长密码
3. **router** — 缺亲和性优先级选择、负载均衡选择、价格过滤
4. **response-converter** — 缺错误响应转换、多模态内容、空内容边界
5. **context-affinity** — 缺 TTL 过期、延迟平均权重公式

#### 完全依赖 E2E 而无单元测试的业务逻辑
1. **Settlement 结算流程** — 代币计量、85/15 分成
2. **Auth 认证流程** — 邮箱验证码、会话管理、密码重置
3. **Connection Pool 连接池管理** — 加入/退出/暂停
4. **Offering 审核流程** — 待审核→通过/拒绝

---

## 三、测试集完善方案

### 3.1 优先级分层

```
P0 (关键路径 + 纯函数 + 零覆盖) — 立即补充
P1 (核心功能 + 覆盖不足)         — 短期完善
P2 (辅助功能 + 边界用例)         — 持续补充
```

### 3.2 P0：纯函数零覆盖模块（新增 5 个测试文件）

#### 3.2.1 `request-converter.test.ts` — 请求格式转换
```
测试文件：apps/platform-api/src/tests/request-converter.test.ts
覆盖模块：src/core/adapters/converter.ts

测试用例：
├─ OpenAI → Anthropic
│  ├─ system message 从 messages 数组提取到 system 字段
│  ├─ 多轮对话消息角色映射
│  ├─ stop_sequences ↔ stop 参数映射
│  ├─ max_tokens / temperature / top_p 参数传递
│  └─ stream 参数保持
├─ Anthropic → OpenAI
│  ├─ system 字段回填到 messages 数组首位
│  ├─ content block 类型处理 (text/image)
│  └─ 参数反向映射
├─ 相同格式 → 不变
├─ 边界用例
│  ├─ 空 messages 数组
│  ├─ 无 system message
│  ├─ 仅 system message
│  └─ 未定义可选参数 (undefined values)
└─ 往返稳定性 (OpenAI→Anthropic→OpenAI 不丢数据)
```
**预计用例数：~15**

#### 3.2.2 `provider-adapters.test.ts` — Provider Adapter 逻辑
```
测试文件：apps/platform-api/src/tests/provider-adapters.test.ts
覆盖模块：src/core/adapters/openai.ts, anthropic.ts

测试用例：
├─ OpenAI Adapter
│  ├─ buildUrl: 拼接 baseUrl + /chat/completions
│  ├─ buildUrl: baseUrl 末尾斜杠处理
│  ├─ buildUrl: 已包含 /v1 路径的处理
│  ├─ buildHeaders: Authorization Bearer token
│  ├─ prepareBody: model 替换为 realModel
│  ├─ extractUsage: 从 JSON 响应提取 prompt_tokens/completion_tokens
│  └─ extractUsage: 从流式最后一个 chunk 提取 usage
├─ Anthropic Adapter
│  ├─ buildUrl: 拼接 baseUrl + /messages
│  ├─ buildHeaders: x-api-key + anthropic-version
│  ├─ prepareBody: max_tokens 默认值 (4096)
│  ├─ extractUsage: 从 message_start 事件提取 input_tokens
│  ├─ extractUsage: 从 message_delta 事件提取 output_tokens
│  └─ extractUsage: JSON 响应中的 usage 对象
└─ 边界用例
   ├─ baseUrl 无协议前缀
   ├─ 空 usage / 无 usage 字段
   └─ max_tokens 超出上下文长度
```
**预计用例数：~15**

#### 3.2.3 `context-manager.test.ts` — 上下文窗口管理
```
测试文件：packages/core/src/context/__tests__/context-manager.test.ts
覆盖模块：packages/core/src/context/context-manager.ts

测试用例：
├─ getContextLimit
│  ├─ 已知模型返回正确限制 (deepseek-chat → 65536)
│  ├─ 未知模型返回默认值 (65536)
│  └─ 模型名子串匹配 (claude-3-sonnet 匹配 claude-3-sonnet)
├─ estimateTokens
│  ├─ 空字符串 → 0
│  ├─ 英文文本 ≈ length/3.5
│  └─ 中文文本估算
├─ trimToContextWindow
│  ├─ 短对话不裁剪
│  ├─ 超长对话裁剪到 80% 窗口
│  ├─ system message 始终保留
│  ├─ 最近一条 user message 始终保留
│  ├─ 至少保留 2 轮对话 (4+ messages 时)
│  └─ 从最旧的消息开始移除
└─ 边界用例
   ├─ 只有 system message
   ├─ 单条超长消息
   └─ 所有消息都是同一角色
```
**预计用例数：~15**

#### 3.2.4 `strip-thinking.test.ts` — Think 标签剥离
```
测试文件：packages/core/src/context/__tests__/strip-thinking.test.ts
覆盖模块：packages/core/src/context/strip-thinking.ts

测试用例：
├─ 无 think 标签 → 原样返回
├─ 单个 <think>...</think> 块移除
├─ 多个 think 块全部移除
├─ 未闭合 <think> 标签处理 (流式场景)
├─ think 块在文本中间
├─ think 块包含换行和特殊字符
└─ 空 think 块 <think></think>
```
**预计用例数：~7**

#### 3.2.5 `retry.test.ts` — 重试与退避
```
测试文件：packages/core/src/resilience/__tests__/retry.test.ts
覆盖模块：packages/core/src/resilience/retry.ts

测试用例：
├─ isRetryableError
│  ├─ TypeError (网络错误) → true
│  ├─ AbortError → false
│  ├─ 普通 Error → false
│  └─ null/undefined → false
├─ isRetryableStatus
│  ├─ 429 → true
│  ├─ 500/502/503 → true
│  ├─ 200/400/401/403/404 → false
├─ withRetry
│  ├─ 首次成功 → 直接返回
│  ├─ 第 2 次成功 → 重试 1 次后返回
│  ├─ 超过最大重试次数 → 抛出最后错误
│  ├─ 指数退避间隔正确 (base * 2^attempt)
│  └─ AbortSignal 中止 → 立即抛出
```
**预计用例数：~12**

### 3.3 P1：覆盖不足模块补充（扩展 4 个现有文件 + 新增 1 个）

#### 3.3.1 扩展 `cache-and-rate-limit.test.ts`
```
新增用例：
├─ rate-limit
│  ├─ 窗口过期后重置 (mock 时间)
│  ├─ 恰好在限额边界 (limit=5, 第 5 次通过, 第 6 次拒绝)
│  ├─ 不同 key 独立计数
│  └─ 连续快速请求
├─ cache
│  ├─ TTL 过期后返回 null
│  ├─ 内存缓存达到上限 (10000) 时 FIFO 淘汰
│  ├─ 不同 key 独立存储
│  └─ Redis 不可用时降级到内存
```
**新增用例数：~8**

#### 3.3.2 扩展 `router-resolve.test.ts`
```
新增用例：
├─ 价格过滤
│  ├─ maxInputPrice 过滤超标 offering
│  ├─ maxOutputPrice 过滤超标 offering
│  └─ 无价格配置 → 不过滤
├─ selectOffering 选择策略 (需 export 或间接测试)
│  ├─ 会话亲和性优先
│  ├─ 用户亲和性次之
│  └─ 负载均衡 (top-3 随机)
```
**新增用例数：~6**

#### 3.3.3 扩展 `response-converter.test.ts`
```
新增用例：
├─ stop reason 映射
│  ├─ stop → end_turn
│  ├─ length → max_tokens
│  ├─ 未知 reason → 原样传递
├─ 边界用例
│  ├─ 空 content 响应
│  ├─ 无 usage 字段的响应
│  └─ 多个 choices/content blocks
├─ 流式边界
│  ├─ 空流 (只有 [DONE])
│  └─ flush 处理不完整事件
```
**新增用例数：~8**

#### 3.3.4 扩展 `password-hash.test.ts` → `crypto-utils.test.ts`
```
新增用例：
├─ hashApiKey
│  ├─ 相同输入 → 相同哈希
│  └─ 不同输入 → 不同哈希
├─ encryptSecret / decryptSecret
│  ├─ 加密-解密往返一致
│  ├─ 不同密钥 → 解密失败
│  └─ 篡改密文 → 解密失败 (auth tag)
├─ hashPassword 边界
│  ├─ 空密码处理
│  ├─ 超长密码 (>1000 字符)
│  └─ 每次生成不同 salt
```
**新增用例数：~8**

#### 3.3.5 新增 `concurrency-limiter.test.ts`
```
测试文件：packages/core/src/executor/__tests__/concurrency-limiter.test.ts
覆盖模块：packages/core/src/executor/concurrency-limiter.ts

测试用例：
├─ 低于上限时直接获取 slot
├─ 达到上限时排队等待
├─ release 后队列中的请求被唤醒
├─ FIFO 顺序保证
├─ 重复 release 不会多释放 slot
└─ 并发 acquire 不超过 maxConcurrency
```
**预计用例数：~6**

### 3.4 P2：边界用例与安全性（长期补充）

#### 3.4.1 `context-affinity.test.ts` 扩展
```
├─ TTL 过期 (30min 会话, 2h 用户) — mock Date.now
├─ 延迟平均公式 (0.7 * old + 0.3 * new)
├─ pruner 清理过期条目
```

#### 3.4.2 `http-utils.test.ts` 新增
```
├─ find_bearer_token_: 有/无 "Bearer " 前缀
├─ find_session_cookie_token_: 多 cookie 解析
├─ get_request_ip_: X-Forwarded-For 多 IP 取首个
├─ Cookie 序列化格式
```

#### 3.4.3 E2E 补充场景
```
├─ 连接池管理: 加入/暂停/退出/模型级 fallback
├─ 供应商 offering 被拒绝流程
├─ API Key 吊销后请求被拒
├─ 结算失败重试
├─ 并发请求竞态
```

---

## 四、实施计划

### Phase 1 — P0 纯函数模块（~70 个用例）

| 步骤 | 文件 | 用例数 | 依赖 |
|------|------|--------|------|
| 1 | `request-converter.test.ts` | ~15 | 无 |
| 2 | `provider-adapters.test.ts` | ~15 | 无 |
| 3 | `context-manager.test.ts` | ~15 | 无 |
| 4 | `strip-thinking.test.ts` | ~7 | 无 |
| 5 | `retry.test.ts` | ~12 | 无 |

**特点：全部是纯函数，无需 mock，可并行开发**

### Phase 2 — P1 覆盖不足模块（~36 个用例）

| 步骤 | 文件 | 用例数 | 依赖 |
|------|------|--------|------|
| 6 | 扩展 `cache-and-rate-limit.test.ts` | ~8 | mock Date |
| 7 | 扩展 `router-resolve.test.ts` | ~6 | mock platformService |
| 8 | 扩展 `response-converter.test.ts` | ~8 | 无 |
| 9 | 重命名+扩展 `crypto-utils.test.ts` | ~8 | 需 XLLMAPI_SECRET_KEY |
| 10 | `concurrency-limiter.test.ts` | ~6 | 无 |

### Phase 3 — P2 边界与安全（~20 个用例）

| 步骤 | 文件 | 用例数 |
|------|------|--------|
| 11 | 扩展 `context-affinity.test.ts` | ~6 |
| 12 | `http-utils.test.ts` | ~8 |
| 13 | E2E 补充场景 | ~6 |

---

## 五、预期效果

| 指标 | 当前 | Phase 1 后 | Phase 2 后 | Phase 3 后 |
|------|------|-----------|-----------|-----------|
| 单元测试数 | ~80 | ~150 | ~186 | ~206 |
| 覆盖模块数 | 10/22 | 15/22 | 19/22 | 22/22 |
| 零覆盖模块 | 7 | 2 | 0 | 0 |
| 纯函数覆盖 | ~50% | ~85% | ~95% | ~98% |

### 核心收益
- **Phase 1** 投入产出比最高：全是纯函数，无需 mock，每个文件独立，可并行编写
- **Phase 2** 补齐关键路径：router 选择策略、缓存/限流边界、加密安全
- **Phase 3** 防御性覆盖：TTL 时间边界、HTTP 解析边界、E2E 新场景
