# xllmapi 发布日志

---

## v0.2.0 — 2026-03-27

### 核心功能

- **跨格式响应自动转换** — 统一端点 `/xllmapi/v1` 现在支持 clientFormat ≠ targetFormat 时自动转换响应格式（流式 + 非流式），实现 OpenAI ↔ Anthropic 双向无感
- **Provider 预设管理** — 管理员可在后台管理供应商预设（厂商、模型、baseUrl、anthropicBaseUrl），不再 hardcode
- **MiniMax Anthropic 双格式支持** — MiniMax 预设新增 `anthropicBaseUrl`，Anthropic SDK 直连 MiniMax Anthropic 端点
- **节点默认配置** — 管理员可配置默认并发数、每日 Token 上限、默认输入/输出定价

### 改进

- **"平台托管" → "平台节点"** — 全平台统一文案
- **API 厂商选择 UI 优化** — 从下拉列表改为卡片式网格，显示厂商名和支持格式
- **模型定价引导修复** — placeholder 正确读取 pricing guidance API 返回值（修复 `res.data` 取值问题）
- **模型勾选不再被刷掉** — 添加模型流程中暂停 30s 自动刷新
- **模型自动检测去重** — AbortController 防止重复调用
- **OpenCode 配置修复** — 使用 `@ai-sdk/openai-compatible` + `@ai-sdk/anthropic` 双 Provider，正确的 limit 配置
- **Claude Code 配置增强** — DeepSeek + MiniMax 双模型，含 API_TIMEOUT_MS
- **文档 API URL 统一** — 非格式说明处统一使用 `/xllmapi/v1`
- **文档移除未验证集成** — 移除 Continue、LobeChat、ChatGPT-Next-Web 页面
- **AI工具集成** — 分类重命名，OpenClaw 改为 "AI Agent 工具"
- **模型信息更新** — DeepSeek V3.2 (128K)、Kimi K2.5 (256K)、MiniMax (200K)

### 数据库

- **migration 012** — 新增 `provider_presets` 表，种子数据包含 DeepSeek、MiniMax、Kimi、OpenAI、Anthropic

### 新增文件

- `core/adapters/response-converter.ts` — 响应格式转换器（JSON + SSE 流状态机）

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
