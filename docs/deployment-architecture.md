# xllmapi 生产部署方案 — 可持续升级架构

## 一、服务器选型

### 网络与备案方案对比

域名未备案时，国内服务器 80/443 端口会被封，需要选择合适的方案：

| 方案 | 成本 | 延迟 | HTTPS | 备案要求 | 迁移成本 | 推荐度 |
|------|------|------|-------|----------|----------|--------|
| **海外 VPS + CF 代理** | 低 | 中等（100-200ms） | CF 自动签发 | 不需要 | 备案后改 DNS 即可迁国内 | ⭐⭐⭐⭐⭐ |
| 海外 VPS 直连 | 低 | 中等 | Caddy 自动签发 | 不需要 | 备案后改 DNS | ⭐⭐⭐⭐ |
| 国内 VPS + IP 直连 | 低 | 低（10-30ms） | 自签证书或非标端口 | 正式发布需要 | 备案后直接切域名 | ⭐⭐⭐ |
| 国内 VPS + CF 代理 | 低 | 高（绕境外回国） | CF 签发 | 不需要 | 不推荐长期 | ⭐⭐ |

### 推荐方案：海外 VPS + Cloudflare 代理

**理由：**
1. 域名不备案也能正常 HTTPS 访问
2. Cloudflare 提供免费 CDN + DDoS 防护 + SSL
3. 备案后只需改 DNS 解析到国内服务器，**零迁移成本**
4. 内测阶段用户少，海外延迟可接受（CF 有亚太节点）

**服务器推荐：**

| 云商 | 地区 | 配置 | 月费约 | 说明 |
|------|------|------|--------|------|
| **Vultr** | 新加坡/东京 | 2C4G | ~$24/月 | 国内访问快，按小时计费 |
| Hetzner | 新加坡 | 2C4G | ~€8/月 | 性价比高 |
| DigitalOcean | 新加坡 | 2C4G | ~$24/月 | 稳定可靠 |
| 阿里云国际 | 新加坡/香港 | 2C4G | ~$20/月 | 国内访问质量好 |

**系统：** Ubuntu 22.04/24.04 LTS
**磁盘：** 50G+ SSD
**带宽：** 海外通常不限流量

### 未来迁移路径（备案后）

```
内测阶段:  用户 → Cloudflare → 海外 VPS
                                ↓
正式发布:  用户 → Cloudflare → 国内 ECS（备案后切 DNS）
           或:  用户 → 国内 CDN → 国内 ECS
```

只需要：
1. 购买国内 ECS，按相同方式部署
2. 数据迁移（pg_dump + pg_restore）
3. DNS 解析从海外 IP 切到国内 IP
4. 用户完全无感

---

## 二、整体架构

```
                 用户浏览器 / API 客户端
                         │
                         ▼
              ┌─────────────────────┐
              │    Caddy (443/80)   │ ← 自动 HTTPS (Let's Encrypt)
              │   api.xllmapi.com   │   SSE/WebSocket 代理
              │   docs.xllmapi.com  │   健康检查路由
              └──────────┬──────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼                               ▼
 ┌──────────────────┐           ┌──────────────┐
 │  PM2 Cluster     │           │  Docs (3001) │ ← Next.js (独立进程)
 │  :3000            │           └──────────────┘
 │  ├── worker #0   │
 │  ├── worker #1   │ ← 滚动重启，任意时刻 N-1 个在线
 │  └── (按 CPU 数)  │
 └────────┬─────────┘
          │
    ┌─────┴──────┐
    ▼            ▼
PostgreSQL    Redis
  :5432       :6379
 (Docker)    (Docker)
```

### 关键设计

1. **Caddy** — 自动 HTTPS + 反向代理 + 健康检查，比 Nginx 配置简单得多
2. **PM2 Cluster** — Node.js 进程管理，`pm2 reload` 实现滚动重启（逐个 worker 重启，零停机）
3. **PostgreSQL + Redis 用 Docker** — 数据服务容器化，方便版本管理和迁移
4. **Platform API 直接跑在宿主机** — 避免 Docker-in-Docker 的复杂性，PM2 直接管理更简单
5. **Docs 站独立进程** — 和平台完全独立，各自升级

---

## 三、初始部署步骤

### 3.1 服务器初始化

```bash
# 创建部署用户
sudo adduser --disabled-password xllmapi
sudo usermod -aG docker xllmapi

# 安装基础软件
sudo apt update && sudo apt install -y curl git docker.io docker-compose-plugin
sudo systemctl enable --now docker

# 安装 Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 PM2
sudo npm install -g pm2

# 安装 Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### 3.2 数据库和 Redis（Docker）

```bash
# 创建数据目录
sudo mkdir -p /data/postgres /data/redis

# docker-compose.yml（仅 DB 服务）
cat > /opt/xllmapi/docker-compose.db.yml << 'EOF'
services:
  postgres:
    image: postgres:17
    restart: always
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_USER: xllmapi
      POSTGRES_PASSWORD: <强密码>
      POSTGRES_DB: xllmapi
    volumes:
      - /data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U xllmapi"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: always
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - /data/redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
EOF

docker compose -f /opt/xllmapi/docker-compose.db.yml up -d
```

### 3.3 部署平台代码

```bash
# 切换到部署用户
sudo su - xllmapi

# 克隆代码
git clone <repo-url> /opt/xllmapi/app
cd /opt/xllmapi/app

# 安装依赖
npm ci

# 配置文件（项目已支持 .platform.xllmapi.json，优先级：环境变量 > 配置文件 > 默认值）
cat > /opt/xllmapi/app/.platform.xllmapi.json << 'CONF'
{
  "env": "production",
  "secretKey": "<openssl rand -hex 32 生成>",
  "database": {
    "driver": "postgres",
    "url": "postgresql://xllmapi:<密码>@127.0.0.1:5432/xllmapi"
  },
  "redis": {
    "url": "redis://127.0.0.1:6379"
  },
  "cors": {
    "origins": ["https://api.xllmapi.com"]
  },
  "appBaseUrl": "https://api.xllmapi.com",
  "email": {
    "provider": "resend",
    "from": "noreply@xllmapi.com",
    "resendApiKey": "<key>"
  }
}
CONF
chmod 600 /opt/xllmapi/app/.platform.xllmapi.json  # 仅 owner 可读

# 少量必须用环境变量的（PM2 传递）
# PORT 和 HOST 通过 pm2.config.cjs 的 env 设置

# 构建
XLLMAPI_RELEASE_ID="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)" npm run build

# 数据库迁移
node apps/platform-api/dist/scripts/apply-postgres-migrations.js

# PM2 启动
pm2 start infra/pm2.config.cjs
pm2 save
pm2 startup  # 开机自启
```

### 3.4 Cloudflare 配置

1. 域名 DNS 托管到 Cloudflare
2. 添加 A 记录：`api.xllmapi.com` → 服务器 IP（橙色云朵开启代理）
3. 添加 A 记录：`docs.xllmapi.com` → 服务器 IP（橙色云朵开启代理）
4. SSL/TLS 模式设置为 **Full (Strict)**
5. Cloudflare → Origin Server → 创建 Origin Certificate（15 年有效期）
6. 下载证书到服务器：`/etc/caddy/cf-origin.pem` 和 `/etc/caddy/cf-origin-key.pem`

### 3.5 Caddy 配置（使用 CF Origin 证书）

```bash
sudo tee /etc/caddy/Caddyfile << 'EOF'
api.xllmapi.com {
    tls /etc/caddy/cf-origin.pem /etc/caddy/cf-origin-key.pem

    reverse_proxy localhost:3000 {
        health_uri /readyz
        health_interval 5s
        health_timeout 3s
    }

    # SSE + WebSocket 支持
    @streaming {
        path /v1/chat/conversations/*/stream
        path /anthropic/v1/messages
        path /v1/chat/completions
        path /xllmapi/v1/*
    }
    reverse_proxy @streaming localhost:3000 {
        flush_interval -1
    }

    # WebSocket
    @ws {
        path /ws/*
    }
    reverse_proxy @ws localhost:3000

    encode gzip zstd
    log {
        output file /var/log/caddy/api-access.log
        format json
    }
}

docs.xllmapi.com {
    tls /etc/caddy/cf-origin.pem /etc/caddy/cf-origin-key.pem
    reverse_proxy localhost:3001
    encode gzip zstd
}
EOF

sudo systemctl reload caddy
```

> **备案后迁移**：切到国内服务器时，可以改用 Caddy 自动 Let's Encrypt 证书（去掉 tls 行即可），或继续用 CF 代理。

### 3.5 Docs 站部署

```bash
cd /opt/xllmapi/docs  # xllmapi-docs 仓库
npm ci && npm run build
pm2 start "npm run start" --name xllmapi-docs --cwd /opt/xllmapi/docs
pm2 save
```

---

## 四、升级流程（无感动态升级）

### 4.1 PM2 配置（关键：wait_ready）

`infra/pm2.config.cjs` 需要增加：

```js
module.exports = {
  apps: [{
    name: "xllmapi",
    script: "apps/platform-api/dist/main.js",
    instances: "max",        // 2C 服务器 = 2 worker
    exec_mode: "cluster",
    max_memory_restart: "512M",
    kill_timeout: 35000,     // > main.ts 的 30s 排水期
    wait_ready: true,        // 等 process.send('ready') 再切流
    listen_timeout: 10000,   // 新 worker 启动超时
    env: {
      NODE_ENV: "production",
      XLLMAPI_ENV: "production"
    }
  }]
};
```

### 4.2 main.ts 添加 ready 信号

```ts
server.listen(PORT, HOST, () => {
  console.log(`[xllmapi] listening on ${HOST}:${PORT}`);
  // PM2 cluster ready 信号 — 新 worker 就绪后才切流量
  if (typeof process.send === 'function') {
    process.send('ready');
  }
});
```

### 4.3 deploy.sh 升级脚本

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/xllmapi/app

RELEASE_ID="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"

# 1. 拉取最新代码
git pull origin main

# 2. 安装依赖
npm ci

# 3. 构建（带版本号）
XLLMAPI_RELEASE_ID="${RELEASE_ID}" npm run build

# 4. 保存前端资源版本
mkdir -p apps/web/releases/${RELEASE_ID}
cp -R apps/web/dist/assets apps/web/releases/${RELEASE_ID}/assets

# 5. 清理旧版本（保留最近 3 个）
cd apps/web/releases
ls -1d */ | head -n -3 | xargs -r rm -rf
cd /opt/xllmapi/app

# 6. 数据库备份 + 迁移
bash scripts/backup-db.sh
node apps/platform-api/dist/scripts/apply-postgres-migrations.js

# 7. 滚动重启（核心：无感升级）
XLLMAPI_RELEASE_ID="${RELEASE_ID}" pm2 reload xllmapi --update-env

# 8. 等待就绪
deadline=$((SECONDS + 60))
until curl -sf http://127.0.0.1:3000/readyz > /dev/null; do
  [ $SECONDS -lt $deadline ] || { echo "FAILED"; exit 1; }
  sleep 2
done

# 9. 验收
XLLMAPI_EXPECT_RELEASE_ID="${RELEASE_ID}" bash scripts/release-smoke.sh

echo "[deploy] ✓ release ${RELEASE_ID} done"
```

### 4.4 升级时序（用户视角）

```
时间线：
t=0   运行 deploy.sh
t=5   代码拉取 + 构建完成
t=10  DB 迁移完成
t=11  pm2 reload 开始
      ├── worker #0 收到 SIGTERM
      │   → /readyz 返回 503（Caddy 不再发新请求给它）
      │   → 在途请求继续处理（30s 排水）
      │   → 退出
      ├── 新 worker #0 启动
      │   → process.send('ready')
      │   → PM2 开始处理 worker #1
      └── ...重复直到所有 worker 更新
t=25  所有 worker 更新完毕
t=30  readyz + smoke test 通过

用户感知：
  - API 调用：无中断（其他 worker 继续服务）
  - 网页浏览：无中断（旧 JS 从 /_releases/ 加载）
  - 流式对话：可能中断（前端显示重试提示）
  - 分布式节点：短暂断连（~5s），自动重连
```

---

## 五、代码修改清单

| 文件 | 修改 | 优先级 |
|------|------|--------|
| `apps/platform-api/src/main.ts` | 添加 `process.send('ready')` | P0 |
| `infra/pm2.config.cjs` | 添加 `wait_ready`、`kill_timeout`、`listen_timeout` | P0 |
| `scripts/deploy.sh` | 完善升级流程（备份+迁移+reload+验收） | P0 |
| `infra/Caddyfile` | SSE/WS 路由 + 健康检查 | P0 |
| `apps/node-cli/` | 节点客户端添加断线自动重连 | P1 |
| `apps/web/src/pages/chat/` | SSE 断线重试 + 用户提示 | P1 |
| `packages/core/src/resilience/circuit-breaker.ts` | 熔断器状态存 Redis | P2 |

---

## 六、日常运维

### 监控

```bash
# 健康状态
curl https://api.xllmapi.com/readyz
curl https://api.xllmapi.com/version

# PM2 状态
pm2 status
pm2 monit

# 日志
pm2 logs xllmapi --lines 50
tail -f /var/log/caddy/api-access.log

# Prometheus metrics
curl http://127.0.0.1:3000/metrics
```

### 回滚

```bash
# 如果升级有问题，回退到上一个 commit
cd /opt/xllmapi/app
git checkout <上一个-commit>
npm ci && npm run build
pm2 reload xllmapi --update-env
```

### 数据库备份

```bash
# 手动备份
bash scripts/backup-db.sh

# 自动备份（crontab）
0 3 * * * /opt/xllmapi/app/scripts/backup-db.sh
```

### 结算失败重试

```bash
# 已有 systemd timer，每 5 分钟自动运行
sudo systemctl enable --now xllmapi-settlement-retry.timer
```

---

## 七、验证方式

```bash
# 1. 初始部署验证
curl https://api.xllmapi.com/healthz
curl https://api.xllmapi.com/readyz
curl https://api.xllmapi.com/version
bash scripts/release-smoke.sh

# 2. 升级无感验证
# 终端 A: 持续请求
while true; do curl -s -o /dev/null -w "%{http_code}\n" https://api.xllmapi.com/readyz; sleep 0.5; done
# 终端 B: 执行升级
bash scripts/deploy.sh
# 观察终端 A: 应该全部 200，无 502/503

# 3. 流式对话验证
# 在网页上发起对话，升级期间观察是否有重连提示

# 4. 节点重连验证
# 启动分布式节点，执行升级，观察节点日志是否自动重连
```

---

## 八、后续扩展路径

当用户增长到 100+ 后：
1. **纵向扩展**：升级到 4C8G / 8C16G
2. **数据库独立**：PostgreSQL 迁移到 RDS（阿里云/腾讯云托管 PG）
3. **Redis 独立**：迁移到云 Redis
4. **多机横向扩展**：多台 ECS + SLB 负载均衡
5. **K8s 迁移**：容器编排，自动扩缩容
