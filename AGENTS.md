# xllmapi 开发调试与发布流程

## 本地开发

```bash
./scripts/dev-up.sh     # 启动 PostgreSQL + Redis + platform-api
./scripts/dev-down.sh   # 停止
```

- Vite dev server 自动代理 `/v1` 等路由到 `localhost:3000`
- 文档链接自动指向 `localhost:3001`（仅 dev 模式）
- 以上 localhost 地址**仅限本地开发**，不会编译进生产 bundle

## 构建规则

- **禁止**直接 `npm run build` 后将产物部署到线上
- 生产构建**必须**通过 `scripts/deploy.sh`（自动设置正确的环境变量）
- Vite build 模式已内置安全默认值（`XLLMAPI_DOCS_URL` 默认指向 `https://docs.xllmapi.com/docs`），作为最后防线

## 发布流程（零停机滚动发布）

```bash
# 1. SSH 到生产服务器
ssh root@43.163.197.216

# 2. 执行标准发布
cd /opt/xllmapi/app
DATABASE_URL='postgresql://xllmapi:xllmapi_prod_2026@127.0.0.1:5432/xllmapi' \
XLLMAPI_SKIP_BACKUP=1 \
bash scripts/deploy.sh
```

deploy.sh 自动完成：
1. `git pull origin main`
2. `npm ci`
3. `XLLMAPI_DOCS_URL=https://docs.xllmapi.com/docs npm run build`
4. 持久化 release assets（保留最近 3 个版本）
5. 数据库迁移
6. `pm2 reload`（零停机滚动重启 2 workers）
7. 健康检查 `/readyz`
8. Smoke test（可选）

## 环境变量清单

### 构建时（Vite define，打入 JS bundle）

| 变量 | 用途 | build 默认值 | dev 默认值 |
|------|------|-------------|-----------|
| `XLLMAPI_API_BASE` | API 端点 | `https://api.xllmapi.com` | `https://api.xllmapi.com` |
| `XLLMAPI_DOCS_URL` | 文档链接 | `https://docs.xllmapi.com/docs` | `http://localhost:3001/docs` |
| `XLLMAPI_RELEASE_ID` | 资源版本路径 | 空 | 空 |

### 运行时（后端 Node.js）

| 变量 | 用途 | 生产必需 |
|------|------|---------|
| `XLLMAPI_ENV` | 环境标识 | Yes |
| `XLLMAPI_SECRET_KEY` | AES 加密密钥 | Yes |
| `DATABASE_URL` | PostgreSQL 连接 | Yes |
| `REDIS_URL` | Redis 连接 | Yes |
| `XLLMAPI_CORS_ORIGINS` | CORS 允许源 | Yes |
| `XLLMAPI_APP_BASE_URL` | 邮件中的平台链接 | Yes |

## 常见陷阱

1. **本地 build 产物不可 scp 到服务器** — Vite `define` 在构建时注入环境相关值，本地 build 会包含 localhost
2. **`.platform.xllmapi.json` 是本地开发配置** — 生产环境在服务器 `/opt/xllmapi/app/.platform.xllmapi.json` 有独立配置（`env: "production"`）
3. **pm2 reload vs restart** — 使用 `pm2 reload` 实现零停机，不要用 `pm2 restart`
4. **DATABASE_URL 未持久化** — 服务器环境未 export DATABASE_URL，deploy.sh 时需手动传入或从配置文件读取
