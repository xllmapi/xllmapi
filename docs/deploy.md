# xllmapi 部署文档

## 架构概览

```
用户浏览器
    │
    ▼
┌──────────────────────────┐
│  Platform API :3000      │ ← Node.js / TypeScript
│  (Web + API + Provider)  │
└──────────┬───────────────┘
           │ HTTPS
           ▼
  OpenAI / DeepSeek / Anthropic / OpenAI-compatible

依赖服务:
  PostgreSQL :5432   ← 主数据库
  Redis :6379        ← 速率限制 / 幂等缓存 / 鉴权频控
```

| 服务 | 端口 | 说明 |
|------|------|------|
| Platform API | 3000 | Web 前端 + REST API + SSE 流式 + Provider 执行 |
| PostgreSQL | 5432 | 用户、凭据、offerings、账本 |
| Redis | 6379 | 速率限制、幂等缓存、鉴权频控 |

---

## 方式一：Docker Compose 部署（推荐）

### 前置条件

- Docker 24+ 和 Docker Compose v2
- 至少 2GB 内存

### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/xllmapi/xllmapi.git
cd xllmapi

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，至少设置：
#   XLLMAPI_ENV=production
#   XLLMAPI_SECRET_KEY=<随机生成的32位以上密钥>
#   XLLMAPI_DB_DRIVER=postgres
#   DATABASE_URL=<生产库连接串>
#   REDIS_URL=<生产 Redis 连接串>
#   XLLMAPI_CORS_ORIGINS=https://app.example.com
#   XLLMAPI_NODE_IMAGE=<可选，Docker 基础镜像源>

# 3. 一键启动
docker compose -f infra/docker/docker-compose.yml up --build -d

# 4. 检查健康状态
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
curl http://localhost:3000/version
bash scripts/release-smoke.sh
```

### 服务启动顺序

Docker Compose 会自动处理依赖：

1. PostgreSQL 就绪（health check: `pg_isready`）
2. Redis 就绪
3. Platform API 启动（依赖上述两者）

### 查看日志

```bash
docker compose -f infra/docker/docker-compose.yml logs -f platform-api
```

---

## 方式二：手动部署

### 前置条件

- Node.js 22+
- PostgreSQL 15+
- Redis 7+

### 1. 安装依赖并构建

```bash
# 安装 Node 依赖
npm install

# 构建全部
npm run build
```

### 2. 数据库迁移

```bash
export DATABASE_URL=postgres://xllmapi:yourpassword@localhost:5432/xllmapi

# 创建数据库（如果还没有）
createdb xllmapi

# 执行迁移
npm run db:migrate:postgres --workspace @xllmapi/platform-api
```

迁移脚本位于 `infra/sql/postgres/`，当前包含 10 个版本：

| 文件 | 内容 |
|------|------|
| 001_launch_mvp.sql | 核心表：users, wallets, credentials, offerings, api_requests, ledger, settlement |
| 002_auth_market_public.sql | 认证与市场 |
| 003_security_profile.sql | 安全与用户资料 |
| 004_chat_and_model_names.sql | Chat 功能 |
| 005_provider_key_fingerprint.sql | Provider Key 指纹去重 |
| 006_performance_indexes.sql | 性能索引 |
| 007_notifications_and_config.sql | 通知与平台配置 |
| 008_node_network.sql | 节点网络基础能力 |
| 009_provider_endpoints.sql | 多 provider endpoint 扩展 |
| 010_settlement_failures.sql | 结算失败持久化与手动补偿 |

### 3. 配置环境变量

```bash
# 必须设置
export XLLMAPI_ENV=production
export XLLMAPI_SECRET_KEY="$(openssl rand -hex 32)"
export XLLMAPI_DB_DRIVER=postgres
export DATABASE_URL=postgres://xllmapi:yourpassword@localhost:5432/xllmapi

# 推荐设置
export REDIS_URL=redis://localhost:6379
export XLLMAPI_CORS_ORIGINS=https://app.example.com

# 可选调优
export PORT=3000
export HOST=0.0.0.0
export XLLMAPI_RELEASE_ID="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
export XLLMAPI_CHAT_RATE_LIMIT_PER_MINUTE=60
export XLLMAPI_SESSION_COOKIE_NAME=xllmapi_session
export XLLMAPI_SESSION_MAX_AGE_SECONDS=2592000
```

### 4. 启动服务

```bash
# Platform API（同时提供 Web 前端）
node apps/platform-api/dist/main.js
```

### 4.1 结算失败补偿

```bash
# 先构建，再批量重试 open settlement failures
export XLLMAPI_SETTLEMENT_RETRY_ACTOR_ID=admin_demo
npm run ops:retry:settlement-failures

# 仅预览，不执行 retry
XLLMAPI_SETTLEMENT_RETRY_DRY_RUN=1 npm run ops:retry:settlement-failures

# 若执行结束后仍有 open failures，则返回非 0
XLLMAPI_SETTLEMENT_RETRY_FAIL_ON_OPEN_REMAINING=1 npm run ops:retry:settlement-failures
```

该脚本会读取 `settlement_failures` 中未解决的记录，逐条重试，并输出 `retried / alreadySettled / failed` 汇总。
退出码约定：

- `0`: 成功，或 dry-run 仅用于预览
- `2`: 配置错误
- `3`: 存在 retry 失败
- `4`: 启用了 `XLLMAPI_SETTLEMENT_RETRY_FAIL_ON_OPEN_REMAINING=1` 且仍有 open failures

如需定时执行，可使用 systemd timer：

```ini
# /etc/systemd/system/xllmapi-settlement-retry.service
[Unit]
Description=xllmapi settlement retry
After=network.target

[Service]
Type=oneshot
User=xllmapi
WorkingDirectory=/opt/xllmapi
Environment=XLLMAPI_SETTLEMENT_RETRY_ACTOR_ID=admin_demo
ExecStart=/usr/bin/npm run ops:retry:settlement-failures

# /etc/systemd/system/xllmapi-settlement-retry.timer
[Unit]
Description=Run xllmapi settlement retry every 5 minutes

[Timer]
OnBootSec=2m
OnUnitActiveSec=5m
Unit=xllmapi-settlement-retry.service

[Install]
WantedBy=timers.target
```
仓库内已提供模板文件：

- `infra/systemd/xllmapi-platform.service`
- `infra/systemd/xllmapi-settlement-retry.service`
- `infra/systemd/xllmapi-settlement-retry.timer`

### 5. 使用 systemd 管理（生产推荐）

```ini
# /etc/systemd/system/xllmapi-platform.service
[Unit]
Description=xllmapi Platform API
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=xllmapi
WorkingDirectory=/opt/xllmapi
Environment=XLLMAPI_ENV=production
Environment=XLLMAPI_SECRET_KEY=your-secret-key
Environment=XLLMAPI_DB_DRIVER=postgres
Environment=DATABASE_URL=postgres://xllmapi:password@localhost:5432/xllmapi
Environment=REDIS_URL=redis://localhost:6379
Environment=XLLMAPI_CORS_ORIGINS=https://app.example.com
ExecStart=/usr/bin/node apps/platform-api/dist/main.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now xllmapi-platform
```

发布验收建议以 `GET /readyz` 为最终门槛，而不是仅检查 `GET /healthz`。
`/healthz` 只表示进程存活；`/readyz` 表示实例已完成依赖检查并可接流量。

---

## CI 发布关卡

当前仓库的 GitHub Actions 默认包含以下发布关卡：

1. workspace build
2. Docker image build
3. PostgreSQL migration smoke
4. `platform-api` 测试
5. `test:e2e:mvp`
6. `test:e2e:sharing`（仅 `main` 分支）
7. production container smoke（`/healthz`、`/readyz`、`/version`）

也可以在手工发布或 staging 验收时复用同一套检查：

```bash
# 默认检查 http://127.0.0.1:3000
npm run smoke:release

# 指定 URL 和期望 release id
XLLMAPI_SMOKE_BASE_URL=https://app.example.com \
XLLMAPI_EXPECT_RELEASE_ID=20250325120000 \
npm run smoke:release
```
---

## 环境变量完整参考

### Platform API

| 变量 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `XLLMAPI_ENV` | 生产环境必须 | development | 设为 `production` 启用安全检查 |
| `XLLMAPI_SECRET_KEY` | 生产环境必须 | dev 内置 | AES-256-GCM 加密密钥，用于加密 Provider 凭据 |
| `XLLMAPI_DB_DRIVER` | 否 | sqlite | `sqlite` 或 `postgres` |
| `DATABASE_URL` | postgres 时必须 | — | PostgreSQL 连接字符串 |
| `XLLMAPI_DB_PATH` | sqlite 时 | .data/xllmapi.db | SQLite 文件路径 |
| `REDIS_URL` | 否 | — | Redis 连接地址 |
| `PORT` | 否 | 3000 | HTTP 端口 |
| `HOST` | 否 | 0.0.0.0 | 监听地址 |
| `XLLMAPI_NODE_IMAGE` | 否 | `swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:24-bookworm-slim` | Docker 构建使用的 Node 基础镜像 |
| `XLLMAPI_CHAT_RATE_LIMIT_PER_MINUTE` | 否 | 60 | 每 API Key 每分钟请求上限 |
| `XLLMAPI_APP_BASE_URL` | 生产建议必须 | — | 用于构造密码重置、邮箱确认、邀请链接 |
| `XLLMAPI_EMAIL_PROVIDER` | 否 | development:`mock` production:`resend` | 事务邮件 provider |
| `XLLMAPI_EMAIL_FROM` | 生产环境必须 | — | 发件地址 |
| `XLLMAPI_EMAIL_REPLY_TO` | 否 | — | 回复地址 |
| `XLLMAPI_RESEND_API_KEY` | `resend` 时必须 | — | Resend API key |
| `XLLMAPI_AUTH_CODE_TTL_SECONDS` | 否 | 600 | 邮箱验证码 TTL |
| `XLLMAPI_PASSWORD_RESET_TTL_SECONDS` | 否 | 1800 | 密码重置链接 TTL |
| `XLLMAPI_EMAIL_CHANGE_TTL_SECONDS` | 否 | 1800 | 邮箱变更确认链接 TTL |
| `XLLMAPI_EMAIL_SEND_COOLDOWN_SECONDS` | 否 | 60 | 邮件发送冷却提示秒数 |
| `XLLMAPI_SECURITY_NOTIFY_EMAIL_ENABLED` | 否 | 1 | 是否发送密码/邮箱变更通知 |
| `XLLMAPI_SESSION_COOKIE_NAME` | 否 | xllmapi_session | 浏览器 HttpOnly session cookie 名称 |
| `XLLMAPI_SESSION_MAX_AGE_SECONDS` | 否 | 2592000 | session cookie 生命周期（秒） |

---

## 初始化管理员

首次部署后，系统会自动创建一个 demo 管理员账号：

- 邮箱: `admin_demo@xllmapi.local`
- 登录方式: 邮箱验证码（开发环境验证码固定为 `000000`）

**生产环境**建议：首次登录后在管理后台邀请真实管理员邮箱，然后禁用 demo 账号。

---

## 事务邮件与账户安全

当前版本已实现以下邮件链路：

1. 邀请邮件
2. 邮箱验证码登录/注册
3. 忘记密码 / 重置密码
4. 邮箱变更确认
5. 密码与邮箱变更安全通知

生产部署建议：

1. 使用 `XLLMAPI_EMAIL_PROVIDER=resend`
2. 配置 `XLLMAPI_APP_BASE_URL` 为外部可访问域名
3. 在 admin 后台定期检查：
   - `/admin/email-deliveries`
   - `/admin/security-events`

---

## 反向代理配置（Nginx 示例）

```nginx
server {
    listen 80;
    server_name api.xllmapi.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE streaming 支持
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
    }
}
```

---

## 监控

```bash
# 健康检查
curl http://localhost:3000/healthz

# Metrics（Prometheus 格式）
curl http://localhost:3000/metrics
```

仓库内已提供 Prometheus 告警规则：

- `infra/observability/prometheus-alerts.yml`

推荐至少落地以下告警：

1. 实例不可抓取
2. settlement failure 增长
3. provider/core errors 激增
4. auth rate-limit 异常增长
5. chat rate-limit 异常增长

Prometheus 抓取示例和告警说明见：

- `infra/observability/README.md`

---

## 安全注意事项

1. **XLLMAPI_SECRET_KEY** 是最关键的密钥，用于加密所有 Provider API Key。生产环境务必使用强随机值。
2. Provider API Key 使用 AES-256-GCM 加密后存储，不以明文落库。
3. 同一用户提交相同 Provider/baseUrl/Key 会被指纹检测拒绝。
4. `/metrics`、`/readyz`、admin 路由建议限制在内网或经反向代理访问控制。
5. 生产环境启用 HTTPS（通过 Nginx/Caddy 等反向代理）。

---

## 故障排查

| 现象 | 可能原因 | 排查方法 |
|------|----------|----------|
| Chat 无响应 | Platform API 未就绪、数据库或 Redis 异常、上游 Provider 故障 | `curl http://127.0.0.1:3000/readyz`，再检查 `/metrics` 与应用日志 |
| Chat 返回 402 | 用户余额不足 | 检查 wallet 接口 |
| Chat 返回 404 | 模型无可用 offering | 确认有用户提交了该模型的 Key |
| Provider Key 提交失败 | 连通性测试失败 | 检查 Key 是否有效，Provider 服务是否可达 |
| Provider Key 409 | 重复提交 | 同一 Key 已被该用户提交过 |
| 前端白屏 | 构建产物缺失 | 确认 `apps/web/dist/` 存在 |
