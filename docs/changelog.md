# xllmapi 发布日志

---

## v0.1.2 — 2026-03-27

**Release ID**: `fab7737-20260327025709`

### 新功能

- **导航栏"生态"下拉菜单** — 包含 xllmapi 论坛、开源主页、MCPP 社区、QQ 群（点击复制群号）

### 运维

- **自动数据库备份** — 配置每日凌晨 3 点 pg_dump，保留 7 天
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
