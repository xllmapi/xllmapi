---

# 一、线上服务状态

| 服务 | 地址 | 状态 |
|------|------|------|
| 平台 | https://xllmapi.com | 运行中 |
| API | https://api.xllmapi.com | 运行中 |
| 文档 | https://docs.xllmapi.com/docs | 运行中 |
| 管理后台 | https://xllmapi.com/admin | 管理员可访问 |
| 监控 | https://sunrisepeak.grafana.net | Grafana Cloud |

**服务器**：腾讯云轻量应用服务器 东京
**配置**：2C4G 60G SSD 30M 带宽 1.5TB/月流量
**IP**：43.163.197.216
**系统**：Ubuntu 24.04 LTS

---

# 二、架构总览

```
用户浏览器 / API 客户端
        │
        ▼
┌─────────────────────────────┐
│      Cloudflare (CDN)       │  ← 自动 HTTPS / DDoS 防护 / 全球 CDN
│  xllmapi.com                │
│  api.xllmapi.com            │
│  docs.xllmapi.com           │
└────────────┬────────────────┘
             │ HTTPS (CF Origin Certificate)
             ▼
┌─────────────────────────────┐
│     Caddy (:443/:80)        │  ← 反向代理 / TLS 终止 / gzip
│  xllmapi.com → :3000        │
│  docs.xllmapi.com → :3001   │
└────────────┬────────────────┘
             │
     ┌───────┴────────┐
     ▼                ▼
┌──────────┐   ┌────────────┐
│ PM2      │   │ Docs :3001 │  ← Next.js (fumadocs)
│ Cluster  │   └────────────┘
│ :3000    │
│ worker#0 │  ← 滚动重启，零停机
│ worker#1 │
└────┬─────┘
     │
┌────┴──────┐
▼           ▼
PostgreSQL  Redis
:5432       :6379
(Docker)    (Docker)
```

---

# 三、所有服务依赖清单

## 3.1 基础设施

| 服务 | 提供商 | 用途 | 年费(RMB) | 免费额度 | 超出价格 |
|------|--------|------|-----------|----------|----------|
| 云服务器 | 腾讯云（国内站） | 平台运行 | ¥199 | - | 续费按原价 |
| 域名 | name.com | xllmapi.com | ~¥79 | - | - |
| CDN + SSL + 防护 | Cloudflare Free | HTTPS/缓存/DDoS | ¥0 | 无限流量 | Pro ¥145/月（不需要） |
| 事务邮件 | Resend Free | 验证码/通知邮件 | ¥0 | 3000封/月, 100封/天 | Pro $20/月(5万封) |
| 监控 | Grafana Cloud Free | Prometheus + 仪表盘 | ¥0 | 10K指标, 50G日志, 14天留存 | Pro ~$50/月 |

**年度总费用：~¥278/年（~¥23/月）**

## 3.2 服务器软件栈

| 软件 | 版本 | 安装方式 | 用途 |
|------|------|----------|------|
| Ubuntu | 24.04 LTS | 系统镜像 | 操作系统 |
| Node.js | 22.17.1 | xlings | 应用运行时 |
| npm | 10.9.2 | 随 Node.js | 包管理 |
| PM2 | 6.0.14 | npm global | 进程管理/集群/零停机重启 |
| Docker | 28.2.2 | apt | 容器运行时 |
| Docker Compose | 2.37.1 | apt | 容器编排 |
| Caddy | 2.11.2 | apt (官方源) | 反向代理 / TLS |
| xlings | 0.4.2 | 官方安装脚本 | 项目依赖管理 |
| PostgreSQL | 17 | Docker | 主数据库 |
| Redis | 7 (Alpine) | Docker | 缓存/限流/幂等 |
| Grafana Alloy | 1.14.2 | apt (grafana源) | Prometheus metrics 采集推送 |

## 3.3 代码仓库

| 仓库 | 位置 | 类型 | 说明 |
|------|------|------|------|
| Sunrisepeak/xllmapi | GitHub 私有 | 平台代码 | Node.js monorepo |
| xllmapi/xllmapi | GitHub 私有 | 公开介绍页 | 仅 README.md（正式发布改公开） |
| xllmapi/xllmapi-docs | GitHub 公开 | 文档站 | fumadocs + Next.js |

## 3.4 DNS 记录

| Type | Name | Content | Proxy | 说明 |
|------|------|---------|-------|------|
| A | @ | 43.163.197.216 | Proxied | 平台主域名 |
| A | api | 43.163.197.216 | Proxied | API 域名 |
| A | docs | 43.163.197.216 | Proxied | 文档站 |
| MX | send | feedback-smtp.ap-northeast-1.amazonses.com | DNS only | Resend 邮件 |
| TXT | _dmarc | v=DMARC1; p=none; | DNS only | 邮件认证 |
| TXT | resend._domainkey | p=MIGfMA0G... | DNS only | DKIM 签名 |
| TXT | send | v=spf1 include:amazonses.com ~all | DNS only | SPF 记录 |

## 3.5 Cloudflare 配置

| 设置 | 值 | 说明 |
|------|-----|------|
| SSL/TLS 模式 | Full (Strict) | 端到端加密 |
| Origin Certificate | 15 年有效 | 存放在 /etc/caddy/ |
| AI Bot 阻止 | Block on all pages | 防止 AI 爬虫 |

---

# 四、服务器目录结构

```
/opt/xllmapi/
├── app/                          # 平台代码（Sunrisepeak/xllmapi）
│   ├── .platform.xllmapi.json   # 生产配置（600 权限）
│   ├── .xlings.json             # 项目依赖声明
│   ├── apps/
│   │   ├── platform-api/        # API 服务
│   │   └── web/                 # 前端
│   │       ├── dist/            # 当前构建
│   │       └── releases/        # 版本化资源（零停机用）
│   ├── infra/
│   │   ├── pm2.config.cjs       # PM2 集群配置
│   │   └── Caddyfile            # Caddy 配置模板
│   └── scripts/
│       ├── deploy.sh            # 升级脚本
│       ├── backup-db.sh         # 数据库备份
│       └── release-smoke.sh     # 发布验收
└── docs/                         # 文档站（xllmapi/xllmapi-docs）

/opt/docker-compose.db.yml        # PostgreSQL + Redis 容器定义
/data/postgres/                   # PostgreSQL 数据持久化
/data/redis/                      # Redis 数据持久化
/etc/caddy/
├── Caddyfile                     # Caddy 主配置
├── cf-origin.pem                 # Cloudflare Origin 证书
└── cf-origin-key.pem             # Cloudflare Origin 私钥（640权限）
/var/log/xllmapi/                 # PM2 日志
/var/log/caddy/                   # Caddy 访问日志
```

---

# 五、配置文件详解

## 5.1 平台配置 `.platform.xllmapi.json`

```json
{
  "env": "production",
  "secretKey": "<AES-256-GCM 密钥，openssl rand -hex 32 生成>",
  "database": {
    "driver": "postgres",
    "url": "postgresql://xllmapi:<密码>@127.0.0.1:5432/xllmapi"
  },
  "redis": {
    "url": "redis://127.0.0.1:6379"
  },
  "cors": {
    "origins": ["https://xllmapi.com", "https://api.xllmapi.com"]
  },
  "appBaseUrl": "https://xllmapi.com",
  "email": {
    "provider": "resend",
    "from": "noreply@xllmapi.com",
    "resendApiKey": "<Resend API Key>"
  }
}
```

优先级：环境变量 > 配置文件 > 默认值

## 5.2 PM2 配置 `infra/pm2.config.cjs`

```js
{
  name: "xllmapi",
  script: "apps/platform-api/dist/main.js",
  instances: "max",           // 按 CPU 数，2C = 2 worker
  exec_mode: "cluster",
  wait_ready: true,           // 等 process.send('ready') 再切流
  listen_timeout: 10000,      // 新 worker 启动超时
  kill_timeout: 35000,        // 等待排水（> 30s）
  max_memory_restart: "512M"
}
```

## 5.3 数据库容器 `docker-compose.db.yml`

PostgreSQL 17 + Redis 7，仅监听 127.0.0.1，数据持久化到 /data/

## 5.4 Grafana Alloy `/etc/alloy/config.alloy`

```hcl
prometheus.scrape "xllmapi" {
  targets         = [{ __address__ = "127.0.0.1:3000" }]
  metrics_path    = "/metrics"
  scrape_interval = "30s"
  forward_to      = [prometheus.remote_write.grafana_cloud.receiver]
}

prometheus.remote_write "grafana_cloud" {
  endpoint {
    url = "https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom/push"
    basic_auth {
      username = "3070888"
      password = "<Grafana Cloud API Token>"
    }
  }
}
```

---

# 六、开发与升级流程

## 6.1 本地开发

```bash
# 启动本地开发环境
./scripts/dev-up.sh      # 启动 PG + Redis + Platform API
npm run dev:web           # 前端热重载
npm run dev:docs          # 文档站热重载（在 xllmapi-docs 目录）

# 停止
./scripts/dev-down.sh
```

## 6.2 代码提交流程

```
本地开发 → 提交到 feature 分支 → 创建 PR → CI 自动测试 → 合并到 main
```

CI 包含：构建检查、单元测试、E2E 测试、容器 smoke test

## 6.3 生产升级（无感，零停机）

```bash
ssh root@43.163.197.216
cd /opt/xllmapi/app
bash scripts/deploy.sh
```

deploy.sh 自动执行：

```
1. git pull origin main            ← 拉最新代码
2. npm ci                          ← 安装依赖
3. npm run build (带 RELEASE_ID)   ← 构建
4. 保存前端资源到 releases/{id}/    ← 旧页面可继续加载旧资源
5. 清理旧版本（保留最近 3 个）
6. pg_dump 备份数据库              ← 迁移前备份
7. 执行数据库迁移                  ← 事务性，失败自动回滚
8. pm2 reload (滚动重启)           ← 逐个 worker 重启
   ├── worker#0: SIGTERM → 排水 30s → 退出
   ├── 新 worker#0: 启动 → send('ready') → 接流量
   └── worker#1: 同上
9. curl /readyz 健康检查            ← 确认新版本就绪
10. release-smoke.sh 验收           ← 检查所有端点
```

**用户视角**：API 调用和网页浏览完全无感知。

## 6.4 文档站升级

```bash
ssh root@43.163.197.216
cd /opt/xllmapi/docs
git pull origin main
npm ci && npm run build
pm2 restart xllmapi-docs
```

## 6.5 仅前端升级（不重启后端）

```bash
ssh root@43.163.197.216
cd /opt/xllmapi/app
git pull origin main
XLLMAPI_DOCS_URL="https://docs.xllmapi.com/docs" npm run build:web
# 前端是静态文件，构建完即生效，无需重启
```

---

# 七、回滚

## 7.1 代码回滚

```bash
cd /opt/xllmapi/app
git log --oneline -5                    # 查看最近提交
git checkout <上一个commit>              # 回到上一个版本
npm ci && npm run build
pm2 reload xllmapi --update-env
curl http://127.0.0.1:3000/readyz       # 确认恢复
```

## 7.2 数据库回滚

deploy.sh 每次升级前会自动备份。手动恢复：

```bash
# 查看备份
ls -la /var/backups/xllmapi/

# 恢复（会覆盖当前数据）
gunzip -c /var/backups/xllmapi/xllmapi_20260327.sql.gz | \
  docker exec -i opt-postgres-1 psql -U xllmapi -d xllmapi
```

## 7.3 完全重建

```bash
# 停止所有服务
pm2 stop all
docker compose -f /opt/docker-compose.db.yml down

# 清除数据（危险！）
rm -rf /data/postgres/* /data/redis/*

# 重新启动
docker compose -f /opt/docker-compose.db.yml up -d
cd /opt/xllmapi/app
node apps/platform-api/dist/scripts/apply-postgres-migrations.js
pm2 start infra/pm2.config.cjs
```

---

# 八、备份策略

## 8.1 数据库备份

```bash
# 手动备份
cd /opt/xllmapi/app && bash scripts/backup-db.sh

# 自动备份（每天凌晨 3 点）
crontab -e
# 添加：
0 3 * * * cd /opt/xllmapi/app && DATABASE_URL="postgresql://xllmapi:xllmapi_prod_2026@127.0.0.1:5432/xllmapi" bash scripts/backup-db.sh

# 备份保留 7 天，自动清理
```

备份文件：`/var/backups/xllmapi/xllmapi_{timestamp}.sql.gz`

## 8.2 配置文件备份

自动备份脚本 `/opt/xllmapi/backup-config.sh`，每周日凌晨 3:30 执行。

覆盖文件：

| 文件 | 内容 | 敏感度 |
|------|------|--------|
| `.platform.xllmapi.json` | AES 密钥、DB 密码、Resend Key | 极高 |
| `cf-origin.pem` + `cf-origin-key.pem` | Cloudflare Origin 证书 | 高（可重新生成） |
| `Caddyfile` | 反向代理配置 | 低 |
| `config.alloy` | Grafana Alloy 监控配置 | 低 |
| `docker-compose.db.yml` | 数据库容器定义 | 低 |

```bash
# 手动执行
bash /opt/xllmapi/backup-config.sh

# 自动：每周日 3:30（cron 已配置）
# 保留 7 天，自动清理
```

备份文件：`/var/backups/xllmapi/config/config_{date}.tar.gz`（权限 600，仅 root 可读）

> **重要**：`.platform.xllmapi.json` 中的 `secretKey` 是最关键的密钥，丢失后所有加密的 Provider API Key 无法解密。建议额外保存一份到本地密码管理器。

## 8.3 系统快照（腾讯云）

腾讯云轻量应用服务器支持手动快照（免费 2 个/实例），覆盖整个系统盘。

**策略**：
- **快照 1**：当前稳定基线（部署完成后创建）
- **快照 2**：每次大版本升级前更新

```
腾讯云控制台 → 轻量应用服务器 → 实例详情 → 快照 → 创建快照
```

命名建议：`baseline-{版本号}-{日期}`，如 `baseline-v0.1.2-20260327`

> 快照包含完整系统盘（代码、配置、数据库文件、所有服务），是灾难恢复的最后保障。

## 8.4 代码备份

代码在 GitHub 私有仓库，天然有版本控制。

## 8.5 备份总览

| 层级 | 内容 | 方式 | 频率 | 保留 |
|------|------|------|------|------|
| 数据库 | PostgreSQL 33 张表 | pg_dump + gzip | 每日 3:00 | 7 天 |
| 配置文件 | 6 个关键文件 | tar.gz 打包 | 每周日 3:30 | 7 天 |
| 系统盘 | 整个服务器 | 腾讯云快照 | 大版本升级前 | 2 个 |
| 代码 | 平台 + 文档 | GitHub 仓库 | 每次 push | 永久 |
| Redis | 限流/幂等缓存 | 不备份 | — | 临时数据，丢失无影响 |

---

# 九、Grafana Cloud 监控

## 9.1 架构

```
xllmapi (:3000/metrics) → Grafana Alloy (每30s抓取) → Grafana Cloud (remote write)
```

## 9.2 服务信息

| 项目 | 值 |
|------|-----|
| Grafana 面板 | https://sunrisepeak.grafana.net |
| Prometheus endpoint | https://prometheus-prod-49-prod-ap-northeast-0.grafana.net |
| Username | 3070888 |
| Agent | Grafana Alloy 1.14.2 |
| 配置文件 | `/etc/alloy/config.alloy` |
| 采集间隔 | 30 秒 |
| 数据留存 | 14 天（Free 计划） |

## 9.3 可用指标

| 指标名 | 类型 | 说明 |
|--------|------|------|
| `xllmapi_total_requests` | counter | 总 HTTP 请求数 |
| `xllmapi_chat_requests` | counter | Chat 请求数 |
| `xllmapi_auth_failures` | counter | 认证失败次数 |
| `xllmapi_auth_rate_limit_hits` | counter | 认证限流触发 |
| `xllmapi_rate_limit_hits` | counter | Chat 限流触发 |
| `xllmapi_settlement_failures` | counter | 结算失败次数 |
| `xllmapi_core_errors` | counter | 核心错误数 |
| `xllmapi_idempotent_replays` | counter | 幂等重放次数 |
| `xllmapi_cache_hits` | counter | 缓存命中次数 |

## 9.4 Alloy 管理

```bash
# 状态
systemctl status alloy

# 重启
systemctl restart alloy

# 日志
journalctl -u alloy -f

# 配置文件
cat /etc/alloy/config.alloy
```

## 9.5 告警建议

在 Grafana Cloud → Alerting 中创建以下告警规则：

| 告警 | 条件 | 说明 |
|------|------|------|
| 实例不可达 | `up == 0` 持续 2 分钟 | 平台进程挂了 |
| 核心错误激增 | `rate(xllmapi_core_errors[5m]) > 1` | 5 分钟内多次错误 |
| 认证限流异常 | `rate(xllmapi_auth_rate_limit_hits[15m]) > 1` | 可能被暴力攻击 |
| 结算失败 | `increase(xllmapi_settlement_failures[10m]) > 0` | 需要人工介入 |

---

# 十、日常运维命令

## 9.1 服务状态

```bash
# PM2 进程状态
pm2 status
pm2 monit                          # 实时监控

# Docker 容器状态
docker ps

# 健康检查
curl https://xllmapi.com/healthz
curl https://xllmapi.com/readyz
curl https://xllmapi.com/version

# Prometheus 指标
curl http://127.0.0.1:3000/metrics
```

## 9.2 日志查看

```bash
# 平台日志
pm2 logs xllmapi --lines 100
pm2 logs xllmapi --err              # 仅错误

# 文档站日志
pm2 logs xllmapi-docs --lines 50

# Caddy 访问日志
tail -f /var/log/caddy/xllmapi-access.log

# 数据库日志
docker logs opt-postgres-1 --tail 50

# Redis 日志
docker logs opt-redis-1 --tail 50
```

## 9.3 服务重启

```bash
# 重启平台（零停机）
pm2 reload xllmapi

# 重启文档站
pm2 restart xllmapi-docs

# 重启 Caddy
systemctl restart caddy

# 重启数据库（会短暂中断！）
docker compose -f /opt/docker-compose.db.yml restart postgres
docker compose -f /opt/docker-compose.db.yml restart redis
```

## 9.4 磁盘清理

```bash
# 清理 Docker 无用镜像
docker system prune -f

# 清理旧日志
pm2 flush

# 查看磁盘使用
df -h /
du -sh /data/postgres /data/redis /var/log/xllmapi /var/log/caddy
```

---

# 十、当前资源占用

| 组件 | 内存 | CPU |
|------|------|-----|
| PM2 worker#0 (platform-api) | ~82 MB | ~0.1% |
| PM2 worker#1 (platform-api) | ~112 MB | ~0.1% |
| PM2 xllmapi-docs | ~60 MB | ~0% |
| PostgreSQL | ~200 MB | idle |
| Redis | ~10 MB | idle |
| Caddy | ~10 MB | idle |
| 系统 + 其他 | ~400 MB | - |
| **总计** | **~900 MB / 3.6 GB** | 富余 ~2.7 GB |

---

# 十一、后续建议

## 短期（1-3 个月）

| 优先级 | 项目 | 状态 | 说明 |
|--------|------|------|------|
| P0 | ~~Resend 域名验证~~ | 已完成 | xllmapi.com 主域名已 Verified |
| P0 | ~~自动备份 cron~~ | 已完成 | 每日凌晨 3 点 pg_dump，保留 7 天 |
| P1 | ~~Grafana Cloud 监控~~ | 已完成 | Alloy agent 每 30s 推送到 sunrisepeak.grafana.net |
| P1 | ~~PM2 startup~~ | 已完成 | 服务器重启后自动恢复 |
| P1 | **前端 SSE 断线重试** | 待做 | 升级时流式对话可能中断，前端加自动重连 |
| P2 | **节点客户端自动重连** | 待做 | 分布式节点 WebSocket 断线后自动重连 |

## 中期（3-6 个月）

| 项目 | 说明 |
|------|------|
| **域名备案** | 备案后可迁移到国内服务器，延迟从 50-100ms 降到 10-30ms |
| **迁移国内** | 购买国内 ECS → 同步部署 → DNS 切换 → 用户无感 |
| **数据库独立** | PG 迁移到云数据库 RDS，提高可靠性 |
| **CI/CD 自动部署** | GitHub Actions push to main → 自动 SSH 执行 deploy.sh |
| **熔断器 Redis 持久化** | 避免重启后熔断器状态丢失 |

## 长期（6 个月+）

| 项目 | 说明 |
|------|------|
| **多节点部署** | 多台服务器 + 负载均衡 |
| **K8s 迁移** | 容器编排，自动扩缩容 |
| **数据库读写分离** | 主从复制，读请求分流 |
| **Redis Cluster** | 高可用 Redis |
| **CDN 静态资源加速** | 前端资源走 CDN，减少源站压力 |

---

# 十二、初始部署完整步骤复现

如需在新服务器上完全重新部署，按以下步骤执行：

```bash
# 1. 安装基础软件
apt update && apt install -y curl git docker.io docker-compose-v2
systemctl enable --now docker

# 2. 安装 xlings + Node.js
curl -fsSL https://d2learn.org/xlings-install.sh | bash
source ~/.bashrc
xlings install node@22
ln -sf $(find ~/.xlings -name "node" -type f | head -1 | xargs dirname)/* /usr/local/bin/

# 3. 安装 PM2
npm install -g pm2
ln -sf $(find ~/.xlings -name "pm2" -type f | head -1) /usr/local/bin/pm2

# 4. 安装 Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/ubuntu any-version main" > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# 5. 启动 PostgreSQL + Redis
mkdir -p /data/postgres /data/redis /opt/xllmapi
# 创建 /opt/docker-compose.db.yml（见上文）
docker compose -f /opt/docker-compose.db.yml up -d

# 6. 克隆代码
cd /opt/xllmapi
git clone git@github.com:Sunrisepeak/xllmapi.git app
git clone git@github.com:xllmapi/xllmapi-docs.git docs

# 7. 配置
# 创建 /opt/xllmapi/app/.platform.xllmapi.json（见上文）
# 上传 CF Origin 证书到 /etc/caddy/
# 配置 /etc/caddy/Caddyfile（见上文）

# 8. 构建 + 迁移 + 启动
cd /opt/xllmapi/app
npm ci
XLLMAPI_DOCS_URL="https://docs.xllmapi.com/docs" npm run build
node apps/platform-api/dist/scripts/apply-postgres-migrations.js
mkdir -p /var/log/xllmapi
pm2 start infra/pm2.config.cjs
pm2 save && pm2 startup

cd /opt/xllmapi/docs
npm ci && npm run build
pm2 start "npm run start" --name xllmapi-docs
pm2 save

systemctl restart caddy

# 9. 安装 Grafana Alloy 监控
apt install -y gpg
mkdir -p /etc/apt/keyrings/
curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" > /etc/apt/sources.list.d/grafana.list
apt update && apt install -y alloy
# 配置 /etc/alloy/config.alloy（见上文 5.4 节）
systemctl enable --now alloy

# 10. 配置自动备份
mkdir -p /var/backups/xllmapi
(crontab -l 2>/dev/null; echo '0 3 * * * cd /opt/xllmapi/app && DATABASE_URL="postgresql://xllmapi:<密码>@127.0.0.1:5432/xllmapi" bash scripts/backup-db.sh >> /var/log/xllmapi/backup.log 2>&1') | crontab -

# 11. 验证
curl https://xllmapi.com/healthz
curl https://docs.xllmapi.com/docs
systemctl status alloy
```

---

# 十三、安全注意事项

| 项目 | 当前状态 | 说明 |
|------|----------|------|
| HTTPS | Cloudflare + Origin Cert | 端到端加密 |
| 密钥加密 | AES-256-GCM | Provider API Key 加密存储 |
| 数据库 | 仅 127.0.0.1 监听 | 外部无法直连 |
| Redis | 仅 127.0.0.1 监听 | 外部无法直连 |
| SSH | 密钥登录 | 建议禁用密码登录 |
| 配置文件 | 600 权限 | 仅 root 可读 |
| CF Origin 私钥 | 640 权限 | caddy 用户可读 |
| CORS | 白名单模式 | 仅允许 xllmapi.com 和 api.xllmapi.com |
| 速率限制 | Redis 存储 | 防止暴力攻击 |
| `/metrics` `/readyz` | 公网可访问 | 建议后续限制为内网或 CF 来源 IP |

**建议加固**：

```bash
# 禁用 SSH 密码登录
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# 限制 metrics 端点仅本地访问（Caddy 层面）
# 在 Caddyfile 中添加：
# @metrics path /metrics /readyz /healthz
# handle @metrics {
#     respond 403
# }
```

---

# 十四、故障排查速查

| 现象 | 可能原因 | 排查命令 |
|------|----------|----------|
| 网站 502 | PM2 进程挂了 | `pm2 status && pm2 logs --err` |
| 网站 522 | Caddy 没运行或 443 端口未开放 | `systemctl status caddy && ss -tlnp \| grep 443` |
| 网站 521 | 服务器宕机 | 腾讯云控制台检查实例状态 |
| API 返回 500 | 数据库连接失败 | `docker ps` 检查 PG 状态，`pm2 logs --err` |
| 邮件收不到 | Resend 配置或域名验证问题 | 检查 Resend 控制台日志 |
| 登录 invite_required | 用户未被邀请 | 管理员在后台发送邀请 |
| 对话返回 404 | 用户未连接该模型 | 到模型网络页面连接模型 |
| 对话返回 402 | token 不足 | 检查用户钱包余额 |
| 文档站 502 | docs 进程挂了 | `pm2 status && pm2 restart xllmapi-docs` |
| 服务器重启后服务没恢复 | PM2 startup 未配置 | `pm2 startup && pm2 save` |
| 磁盘满 | 日志或 Docker 镜像积累 | `df -h && pm2 flush && docker system prune -f` |

---

# 十五、数据库迁移说明

迁移文件位于 `infra/sql/postgres/`，当前已有 11 个版本：

| 文件 | 内容 |
|------|------|
| 001_launch_mvp.sql | 核心表：users, wallets, credentials, offerings, api_requests |
| 002_auth_market_public.sql | 认证与市场 |
| 003_security_profile.sql | 安全与用户资料 |
| 004_chat_and_model_names.sql | Chat 功能 |
| 005_provider_key_fingerprint.sql | Provider Key 指纹去重 |
| 006_performance_indexes.sql | 性能索引 |
| 007_notifications_and_config.sql | 通知与平台配置 |
| 008_node_network.sql | 节点网络 |
| 009_provider_endpoints.sql | 多 provider endpoint |
| 010_settlement_failures.sql | 结算失败追踪 |
| 011_auth_email_security.sql | 邮箱认证与安全 |

**迁移机制**：
- `schema_migrations` 表记录已执行的迁移
- 每个迁移在事务中执行，失败自动回滚
- deploy.sh 中自动运行，无需手动执行
- 新增迁移文件只需递增编号（如 `012_xxx.sql`）

---

# 十六、Resend 邮件配置

**状态：已验证** — 主域名 `xllmapi.com` 已在 Resend 控制台验证通过（Verified，区域 ap-northeast-1 Tokyo）。

Cloudflare DNS 中已配置 SPF + DKIM + DMARC 记录。发件地址 `noreply@xllmapi.com`。

**邮件类型**：
- 注册/登录验证码
- 密码重置链接
- 邮箱变更确认
- 邀请链接
- 安全通知（密码/邮箱变更）

---

# 十七、费用增长预测

| 用户规模 | 需要升级 | 增加费用 |
|----------|----------|----------|
| < 100 | 当前配置足够 | ¥0 |
| 100-500 | 服务器升 4C8G | +¥200-600/年 |
| 500+ | Resend Pro（5 万封/月） | +¥1,730/年 |
| 1000+ | 数据库独立 + 多服务器 | 另行评估 |
