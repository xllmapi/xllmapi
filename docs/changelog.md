# xllmapi 发布日志

---

## v0.3.0 — 2026-04-01

**Release ID**: `6f452b2-20260401213024`

### 核心功能

- **统一 Token 流水记录** — 所有余额变动（注册赠送、管理员调整、API 消费、供应收入、邀请奖励）统一记录到 ledger，可追溯、可备注
- **`GET /v1/ledger` API** — 分页查询 token 流水，支持 `type`/`date`/`model` 过滤，返回关联的模型和 token 明细
- **LedgerService** — 独立服务封装所有 wallet 变动（余额更新 + 流水写入原子事务）
- **邀请奖励机制** — 通过 `platform_config.referral_reward_amount` 控制（默认关闭），邀请人在被邀请者注册后自动获得 token 奖励

### 前端

- **Overview 明细视图统一展示** — 删除冗余「资金流水」tab，所有 token 变动在「按日期」视图中混合显示，系统条目（注册赠送/平台调整/邀请奖励）用天蓝色行区分
- **管理员余额调整 UX** — 实时预览调整后余额，两步确认（首次点击启动 5s 冷却倒计时，结束后再次点击提交），支持备注
- **ConfirmDialog 多输入 + renderExtra** — 通用对话框支持多输入字段和动态内容渲染
- **邀请菜单高亮** — 当平台邀请奖励开启时，侧边栏「邀请注册」菜单绿色高亮 + 脉冲圆点，邀请页面顶部显示奖励横幅

### 数据库

- **022_unified_ledger.sql** — `ledger_entries` 新增 `note`/`related_id`/`actor_id` 列（nullable），`request_id` 改为 nullable 以支持非结算类条目

### 运维

- **Cloudflare WAF 规则** — 新增 Skip 规则：`api.xllmapi.com` 跳过所有 WAF/Bot 检测，解决 OpenAI Python SDK（`User-Agent: OpenAI/Python`）被 Cloudflare "Block AI Bots" 误拦 403 的问题。根因：Cloudflare 按 UA 字符串粗暴匹配 "OpenAI" 关键词，不区分训练爬虫和合法 SDK 调用

---

## v0.2.1 — 2026-03-27

### 核心

- **`/v1/models` SDK 标准格式** — 自动识别 OpenAI/Anthropic 格式返回标准 models 列表，兼容所有 SDK
  - OpenAI 格式：`id` + `object` + `created` + `owned_by` + `context_length`
  - Anthropic 格式：`id` + `display_name` + `type` + `created_at` + `max_input_tokens` + `max_tokens` + 分页
- **短路径统一** — `/chat/completions`、`/messages`、`/models` 均支持（无需 `/v1` 前缀）
- **`https://api.xllmapi.com` 大一统 base URL** — 一个地址兼容 OpenAI SDK、Anthropic SDK、AI SDK、curl

### 新增测试

- `models-endpoint.test.ts` — 6 个集成测试覆盖 `/v1/models`（OpenAI/Anthropic 格式）、`/models`、`/v1/network/models`、`/chat/completions`、`/messages` 短路径

---

## v0.2.0 — 2026-03-27

**Release ID**: `6a60d8b-20260327075656`

### 核心功能

- **跨格式响应自动转换** — 统一端点支持 clientFormat ≠ targetFormat 时自动转换响应格式（流式 + 非流式），OpenAI ↔ Anthropic 双向无感
- **Provider 预设管理** — 管理员可在后台管理供应商预设（厂商、模型、baseUrl、anthropicBaseUrl），不再 hardcode
- **MiniMax Anthropic 双格式支持** — Anthropic SDK 直连 MiniMax Anthropic 端点，正确处理 Thinking
- **节点默认配置** — 管理员可配置默认并发数、每日 Token 上限、默认定价
- **`/messages` 路由** — 支持 AI SDK `@ai-sdk/anthropic` 直接请求 `{baseURL}/messages`
- **API URL 简化** — 对外推荐 `https://api.xllmapi.com` 作为 base URL，平台自动识别格式
- **用户 handle `xu-xxxx`** — 新用户生成 `xu-` 前缀的平台 ID，显示在个人资料页
- **通知支持 handle** — 管理员发通知可通过 `xu-xxxx` 指定目标用户

### 改进

- **"平台托管" → "平台节点"** — 全平台统一文案
- **API 厂商选择 UI** — 从下拉列表改为卡片式网格，显示厂商名和支持格式
- **模型定价引导修复** — placeholder 正确读取 pricing guidance API
- **模型勾选不再被刷掉** — 添加模型流程中暂停 30s 自动刷新
- **模型自动检测去重** — AbortController 防止重复调用
- **安全页修复** — 移除重复的"修改邮箱"区块
- **OpenCode 双 Provider 配置** — `@ai-sdk/openai-compatible` + `@ai-sdk/anthropic`
- **Claude Code 双模型配置** — DeepSeek + MiniMax，含 API_TIMEOUT_MS
- **模型信息更新** — DeepSeek V3.2 (128K)、Kimi K2.5 (256K)、MiniMax (200K)
- **文档 API URL 简化** — 推荐 `https://api.xllmapi.com`，移除未验证集成页面

### 数据库

- **migration 012** — 新增 `provider_presets` 表

### 新增文件

- `core/adapters/response-converter.ts` — 响应格式转换器（JSON + SSE 流状态机）
- `tests/response-converter.test.ts` — 7 个单元测试覆盖转换器

---

## v0.1.2 — 2026-03-27

**Release ID**: `fab7737-20260327025709`

### 新功能

- **导航栏"生态"下拉菜单** — 包含 xllmapi 论坛、开源主页、MCPP 社区、QQ 群（点击复制群号）
- **文档站导航增强** — 添加官网（房子图标）和 GitHub（图标按钮）链接
- **文档首页社区板块** — 论坛、QQ 内测交流群、GitHub 开源主页

### 运维

- **Grafana Cloud 监控** — Alloy agent 每 30s 采集 `/metrics` 推送到 sunrisepeak.grafana.net
- **Resend 主域名验证** — `xllmapi.com` 已 Verified，发件地址 `noreply@xllmapi.com`
- **自动数据库备份** — 每日凌晨 3 点 pg_dump，保留 7 天
- **SSH 安全加固** — 禁用密码登录，仅允许密钥认证
- **清理空壳账号** — 删除 admin_speak 空壳管理员

---

## v0.1.1 — 2026-03-27

**Release ID**: `d0b816e-20260327022637`

### 平台改进

- **"平台代理模型" → "平台模型节点"** — 模型网络页面文案修正，更准确描述节点概念
- **公告栏修复** — 公告横幅现在正确显示在导航栏下方，而非被遮挡
- **公告关闭逻辑优化** — 关闭后存储公告内容而非固定标记，管理员更换公告内容后会自动重新显示
- **认证安全加固** — 非邀请邮箱的 request-code 请求返回通用成功响应，避免泄露邀请状态
- **文档链接指向外部文档站** — 导航栏"文档"链接指向 docs.xllmapi.com

### 文档站

- **导航栏增加官网和 GitHub 链接** — 官网（房子图标）+ GitHub（图标按钮）
- **首页增加交流与支持板块** — xllmapi 论坛、QQ 内测交流群（1092372680）、GitHub 开源主页

### 部署基础设施

- **PM2 wait_ready** — 新 worker 发送 ready 信号后才切流量，确保零停机
- **Caddy 健康检查** — 反向代理层面的 `/readyz` 健康检查
- **deploy.sh 增强** — 自动 smoke test、60s 健康检查超时

---

## v0.1.0 — 2026-03-27

**Release ID**: `4dedefe-20260327004540`

### 首次上线

平台从零部署上线，所有核心功能就绪。

#### 架构

```
用户 → Cloudflare (CDN/SSL) → Caddy (反向代理) → PM2 Cluster (2 workers) → PostgreSQL + Redis (Docker)
```

#### 基础设施

| 服务 | 配置 |
|------|------|
| 服务器 | 腾讯云轻量 东京 2C4G 60G SSD |
| 域名 | xllmapi.com（Cloudflare DNS 托管） |
| HTTPS | Cloudflare Origin Certificate（15 年） |
| 邮件 | Resend（事务邮件） |

#### 在线服务

| 地址 | 说明 |
|------|------|
| https://xllmapi.com | 平台主站 |
| https://api.xllmapi.com | API 端点 |
| https://docs.xllmapi.com | 文档站 |

#### 平台功能

- 多格式 API 代理（OpenAI / Anthropic / xllmapi 统一）
- 模型网络（浏览、连接、使用模型）
- 模型节点（平台托管 / 本地节点）
- 内置 Chat 对话界面
- 用户注册（邀请制）、API Key 管理
- 管理后台（用户管理、公告、通知、用量统计）
- SSE 流式输出
- Token 经济（接入模型获取 token，使用模型消耗 token）

#### 文档站

- 快速开始（注册、对话、API 调用、创建节点）
- 模型网络（概述、模型列表、连接模型、节点、Token 机制）
- API 参考（OpenAI / Anthropic / xllmapi 统一 / 错误码）
- 实用指南（流式输出、函数调用、切换模型、深度思考）
- 工具集成（Claude Code、OpenCode、Cursor、Continue、LobeChat 等）
- 帮助与支持（FAQ、交流渠道、反馈）

#### 年度费用

| 服务 | 费用 |
|------|------|
| 服务器 | ¥199/年 |
| 域名 | ¥79/年 |
| Cloudflare / Resend / Grafana | ¥0（免费额度） |
| **合计** | **¥278/年** |
