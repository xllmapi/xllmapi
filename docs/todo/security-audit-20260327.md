# xllmapi 安全审计报告与建议

## Context

从安全视角全面审计项目代码和本次部署过程，包括对话中暴露的敏感信息。

---

## 一、对话中暴露的敏感信息（最高优先级）

本次对话中以明文出现了以下密钥，**必须立即轮换**：

| 密钥 | 暴露位置 | 风险 | 处理方式 |
|------|----------|------|----------|
| **Resend API Key** `re_DRX1CmFE_...` | 对话中发送 | 可被用于发送邮件 | **立即轮换** |
| **Grafana Cloud Token** `glc_eyJv...` | 对话中发送 | 可被用于推送假指标 | **立即轮换** |
| **Cloudflare Origin 私钥** | 对话中发送 | 可被用于伪造 HTTPS | **立即轮换** |
| **服务器 IP** `43.163.197.216` | 对话中出现 | 被 CF 代理保护，风险中等 | CF 代理已隐藏 |
| **DB 密码** `xllmapi_prod_2026` | SSH 命令中出现 | 仅 127.0.0.1 可达，风险低 | 建议后续更换 |
| **AES Secret Key** `6a4710a1c40...` | 配置文件中 | 解密所有 Provider Key | 建议后续更换 |

### 处理步骤

1. **Resend**：去 https://resend.com/api-keys → 删除旧 key → 创建新 key → 更新服务器配置
2. **Grafana Cloud**：去 Grafana Cloud → Access Policies → 删除旧 token → 创建新 token → 更新 `/etc/alloy/config.alloy`
3. **Cloudflare Origin 证书**：去 CF 控制台 → Origin Certificates → Revoke 旧证书 → 创建新证书 → 更新服务器 `/etc/caddy/cf-origin*.pem`
4. **DB 密码**（后续）：更新 docker-compose + .platform.xllmapi.json + 重启
5. **AES Secret Key**（后续，需谨慎）：更换后所有已加密的 Provider Key 需要重新加密

---

## 二、代码安全审计

### 做得好的部分

| 项目 | 实现 |
|------|------|
| 密码哈希 | scrypt (N=16384, r=8, p=1) + timing-safe 比较 |
| API Key 加密 | AES-256-GCM |
| Session Cookie | HttpOnly + SameSite=Lax + Secure(prod) |
| SQL 注入防护 | 全部使用参数化查询 ($1, $2) |
| 速率限制 | 认证端点已限流（Redis/内存双模式） |
| 安全头 | CSP + HSTS(prod) + X-Frame-Options |
| 生产配置校验 | 启动时强制检查必要配置 |
| .gitignore | 覆盖 .env、.platform.xllmapi.json、dist/ |
| 非邀请邮箱 | 返回通用成功，不泄露邀请状态 |

### 需要修复的问题

#### 严重

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 1 | X-Forwarded-For 可伪造 | `lib/http.ts:224` | 直接信任 header，攻击者可伪造 IP 绕过限流 |

#### 中等

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 2 | 密码哈希依赖 secretKey | `crypto-utils.ts:23` | secretKey 变更会导致所有密码失效 |
| 3 | Demo 用户密码硬编码 | `postgres-platform-repository.ts:379` | admin123456/user123456，仅 dev 模式 |
| 4 | /metrics /version 公开 | `main.ts` | 暴露环境信息和运行指标 |

#### 低

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 5 | docker-compose 默认密码 | `docker-compose.yml` | 开发用，非生产问题 |
| 6 | CORS dev 允许所有 | `security.ts` | 仅开发模式，生产已限制 |

---

## 三、部署安全状态

### 已做好

| 项目 | 状态 |
|------|------|
| HTTPS 端到端加密 | Cloudflare + Origin Certificate |
| 数据库仅本地监听 | 127.0.0.1:5432 |
| Redis 仅本地监听 | 127.0.0.1:6379 |
| SSH 密钥登录 | 已禁用密码 |
| 配置文件权限 | 600 (仅 root) |
| CORS 白名单 | 仅 xllmapi.com + api.xllmapi.com |
| CF 代理隐藏源 IP | 已开启 Proxy (橙色云朵) |

### 需要加固

| 项目 | 建议 |
|------|------|
| /metrics 端点 | 限制仅 127.0.0.1 或 CF 来源 IP 可访问 |
| 腾讯云防火墙 | 收紧规则，443/80 仅允许 CF IP 段 |
| fail2ban | 安装防暴力破解 |
| 自动安全更新 | 启用 unattended-upgrades |

---

## 四、处理方案

### 立即（今天）

1. 轮换 Resend API Key
2. 轮换 Grafana Cloud Token
3. 轮换 Cloudflare Origin 证书
4. 更新服务器上对应配置并重启

### 短期（本周）

5. 修复 X-Forwarded-For：仅信任 CF IP 段来源的 header
6. 限制 /metrics 端点访问
7. 安装 fail2ban
8. 启用自动安全更新
9. 添加 git pre-commit hook 扫描密钥

### 中期

10. 密码哈希解耦 secretKey
11. 收紧腾讯云防火墙（仅允许 CF IP 段访问 443）
12. 定期 npm audit

---

## 五、输出

保存到 `docs/todo/security-audit-20260327.md`，待明天处理。
