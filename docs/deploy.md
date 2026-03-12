# xllmapi 部署文档

## 架构概览

```
用户浏览器
    │
    ▼
┌─────────────────────┐
│  Platform API :3000  │ ← Node.js / TypeScript
│  (Web + API 一体)    │
└───────┬─────────────┘
        │ HTTP (internal)
        ▼
┌─────────────────────┐
│  Core Router :4001   │ ← C++ 高性能执行层
│  (路由 / 熔断 / 调用) │
└───────┬─────────────┘
        │ HTTPS
        ▼
  OpenAI / DeepSeek / Anthropic ...

依赖服务:
  PostgreSQL :5432   ← 主数据库
  Redis :6379        ← 速率限制 / 幂等缓存
```

| 服务 | 端口 | 说明 |
|------|------|------|
| Platform API | 3000 | Web 前端 + REST API + SSE 流式 |
| Core Router Executor | 4001 | LLM Provider 路由与执行 |
| PostgreSQL | 5432 | 用户、凭据、offerings、账本 |
| Redis | 6379 | 速率限制、幂等缓存（可选但推荐） |

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
cp infra/docker/.env.example infra/docker/.env
# 编辑 .env 文件，至少设置：
#   XLLMAPI_SECRET_KEY=<随机生成的32位以上密钥>
#   XLLMAPI_ENV=production

# 3. 一键启动
docker compose -f infra/docker/docker-compose.yml up --build -d

# 4. 检查健康状态
curl http://localhost:3000/healthz
curl http://localhost:4001/healthz
```

### 服务启动顺序

Docker Compose 会自动处理依赖：

1. PostgreSQL 就绪（health check: `pg_isready`）
2. Redis 就绪
3. Core Router Executor 启动
4. Platform API 启动（依赖上述三者）

### 查看日志

```bash
docker compose -f infra/docker/docker-compose.yml logs -f platform-api
docker compose -f infra/docker/docker-compose.yml logs -f core-router-executor
```

---

## 方式二：手动部署

### 前置条件

- Node.js 22+
- PostgreSQL 15+
- Redis 7+（可选）
- GCC 15+ 和 xmake（编译 Core Router）
- 或使用预编译的 core-router-executor 二进制

### 1. 安装依赖并构建

```bash
# 安装 Node 依赖
npm install

# 构建全部（shared-types → web → platform-api）
npm run build

# 构建 C++ Core Router
cd apps/core-router-executor
xmake build
cd ../..
```

### 2. 数据库迁移

```bash
export DATABASE_URL=postgres://xllmapi:yourpassword@localhost:5432/xllmapi

# 创建数据库（如果还没有）
createdb xllmapi

# 执行迁移
npm run db:migrate:postgres --workspace @xllmapi/platform-api
```

迁移脚本位于 `infra/sql/postgres/`，包含 5 个版本：

| 文件 | 内容 |
|------|------|
| 001_launch_mvp.sql | 核心表：users, wallets, credentials, offerings, api_requests, ledger, settlement |
| 002_auth_market_public.sql | 认证与市场 |
| 003_security_profile.sql | 安全与用户资料 |
| 004_chat_and_model_names.sql | Chat 功能 |
| 005_provider_key_fingerprint.sql | Provider Key 指纹去重 |

### 3. 配置环境变量

```bash
# 必须设置
export XLLMAPI_ENV=production
export XLLMAPI_SECRET_KEY="$(openssl rand -hex 32)"  # 两个服务必须相同
export XLLMAPI_DB_DRIVER=postgres
export DATABASE_URL=postgres://xllmapi:yourpassword@localhost:5432/xllmapi

# 推荐设置
export REDIS_URL=redis://localhost:6379

# 可选调优
export PORT=3000
export HOST=0.0.0.0
export CORE_BASE_URL=http://127.0.0.1:4001
export XLLMAPI_CHAT_RATE_LIMIT_PER_MINUTE=60
```

### 4. 启动服务

```bash
# 终端 1：Core Router Executor
export XLLMAPI_ENV=production
export XLLMAPI_SECRET_KEY="same-as-above"
./apps/core-router-executor/build/linux/x86_64/release/core-router-executor

# 终端 2：Platform API（同时提供 Web 前端）
node apps/platform-api/dist/main.js
```

### 5. 使用 systemd 管理（生产推荐）

```ini
# /etc/systemd/system/xllmapi-core.service
[Unit]
Description=xllmapi Core Router Executor
After=network.target

[Service]
Type=simple
User=xllmapi
WorkingDirectory=/opt/xllmapi
Environment=XLLMAPI_ENV=production
Environment=XLLMAPI_SECRET_KEY=your-secret-key
ExecStart=/opt/xllmapi/apps/core-router-executor/build/linux/x86_64/release/core-router-executor
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/xllmapi-platform.service
[Unit]
Description=xllmapi Platform API
After=network.target postgresql.service redis.service xllmapi-core.service

[Service]
Type=simple
User=xllmapi
WorkingDirectory=/opt/xllmapi
Environment=XLLMAPI_ENV=production
Environment=XLLMAPI_SECRET_KEY=your-secret-key
Environment=XLLMAPI_DB_DRIVER=postgres
Environment=DATABASE_URL=postgres://xllmapi:password@localhost:5432/xllmapi
Environment=REDIS_URL=redis://localhost:6379
Environment=CORE_BASE_URL=http://127.0.0.1:4001
ExecStart=/usr/bin/node apps/platform-api/dist/main.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now xllmapi-core xllmapi-platform
```

---

## 环境变量完整参考

### Platform API

| 变量 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `XLLMAPI_ENV` | 生产环境必须 | development | 设为 `production` 启用安全检查 |
| `XLLMAPI_SECRET_KEY` | 生产环境必须 | dev 内置 | AES-256-GCM 加密密钥，与 Core Router 共享 |
| `XLLMAPI_DB_DRIVER` | 否 | sqlite | `sqlite` 或 `postgres` |
| `DATABASE_URL` | postgres 时必须 | — | PostgreSQL 连接字符串 |
| `XLLMAPI_DB_PATH` | sqlite 时 | .data/xllmapi.db | SQLite 文件路径 |
| `REDIS_URL` | 否 | — | Redis 连接地址 |
| `PORT` | 否 | 3000 | HTTP 端口 |
| `HOST` | 否 | 0.0.0.0 | 监听地址 |
| `CORE_BASE_URL` | 否 | http://127.0.0.1:4001 | Core Router 地址 |
| `XLLMAPI_CHAT_RATE_LIMIT_PER_MINUTE` | 否 | 60 | 每 API Key 每分钟请求上限 |

### Core Router Executor

| 变量 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| `XLLMAPI_ENV` | 否 | development | 环境标识 |
| `XLLMAPI_SECRET_KEY` | 生产环境必须 | dev 内置 | 解密 Provider 凭据的密钥 |
| `XLLMAPI_CORE_MAX_CONCURRENT_REQUESTS` | 否 | 32 | 最大并发数 |
| `XLLMAPI_CORE_MAX_RETRIES` | 否 | 1 | Provider 调用失败重试次数 |
| `XLLMAPI_CORE_RETRY_BACKOFF_MS` | 否 | 250 | 重试间隔 (ms) |
| `XLLMAPI_CORE_CIRCUIT_FAILURE_THRESHOLD` | 否 | 3 | 熔断器连续失败阈值 |
| `XLLMAPI_CORE_CIRCUIT_OPEN_MS` | 否 | 30000 | 熔断器打开持续时间 (ms) |

---

## 初始化管理员

首次部署后，系统会自动创建一个 demo 管理员账号：

- 邮箱: `admin_demo@xllmapi.local`
- 登录方式: 邮箱验证码（开发环境验证码固定为 `000000`）

**生产环境**建议：首次登录后在管理后台邀请真实管理员邮箱，然后禁用 demo 账号。

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
curl http://localhost:4001/healthz

# Metrics（Prometheus 格式）
curl http://localhost:3000/metrics
curl http://localhost:4001/metrics
```

---

## 安全注意事项

1. **XLLMAPI_SECRET_KEY** 是最关键的密钥，用于加密所有 Provider API Key。生产环境务必使用强随机值，且两个服务必须使用相同的值。
2. Provider API Key 使用 AES-256-GCM 加密后存储，不以明文落库。
3. 同一用户提交相同 Provider/baseUrl/Key 会被指纹检测拒绝。
4. Core Router 仅监听内网端口，不应暴露到公网。
5. 生产环境启用 HTTPS（通过 Nginx/Caddy 等反向代理）。

---

## 故障排查

| 现象 | 可能原因 | 排查方法 |
|------|----------|----------|
| Chat 无响应 | Core Router 未启动 | `curl http://127.0.0.1:4001/healthz` |
| Chat 返回 402 | 用户余额不足 | 检查 wallet 接口 |
| Chat 返回 404 | 模型无可用 offering | 确认有用户提交了该模型的 Key |
| Provider Key 提交失败 | 连通性测试失败 | 检查 Key 是否有效，Provider 服务是否可达 |
| Provider Key 409 | 重复提交 | 同一 Key 已被该用户提交过 |
| 前端白屏 | 构建产物缺失 | 确认 `apps/web/dist/` 存在 |
