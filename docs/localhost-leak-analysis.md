# localhost 泄露到生产环境 — 分析报告

> 日期：2026-03-30

## 1. 问题描述

线上前端页面中的文档链接指向 `localhost` 而非生产域名，此 bug 已出现过两次。

## 2. 根因分析

### 直接原因

`apps/web/vite.config.ts` 中 `XLLMAPI_DOCS_URL` 的默认值是 `http://localhost:3001/docs`，通过 Vite 的 `define` 机制在**构建时**硬编码进前端 JS bundle。

### 触发条件

`scripts/deploy.sh` 正确设置了 `XLLMAPI_DOCS_URL=https://docs.xllmapi.com/docs`，但开发者**绕过 deploy.sh 直接运行 `npm run build`** 时，环境变量未设置，localhost 默认值被打入 bundle 并部署到线上。

### 根本原因

构建流程缺少防护机制 — 没有区分 dev/build 模式的默认值策略，任何绕过 deploy.sh 的构建都会产生包含 localhost 的产物。

## 3. 全量 localhost 审计

### CRITICAL — 直接影响线上用户

| 文件 | 行号 | 问题 | 影响 |
|------|------|------|------|
| `apps/web/vite.config.ts` | 8 | `XLLMAPI_DOCS_URL` 默认值 `localhost:3001` | Header、Footer、HomePage 文档链接指向 localhost |
| `apps/web/src/pages/app/ModelsManagePage.tsx` | 1340, 1346, 1353, 1650, 1656, 1663 | 硬编码 `ws://localhost:3000/ws/node` | 用户复制安装指南后节点连接失败 |
| `apps/platform-api/src/services/platform-service.ts` | 494, 601, 718, 763 | 邮件 URL fallback `http://127.0.0.1:3000` | 密码重置/邮箱验证/邀请链接失效 |

### SAFE — 仅限开发/基础设施（无需修改）

| 文件 | 说明 |
|------|------|
| `vite.config.ts` server.proxy | 仅 Vite dev server 生效，不编译进 bundle |
| `scripts/deploy.sh` healthcheck URL | 有环境变量覆盖，服务端内部调用 |
| `infra/Caddyfile` reverse_proxy | 正确的反向代理模式（同机通信） |
| `.env.example`, CI/CD | 示例/测试环境 |
| `ModelsManagePage.tsx` 中 `http://localhost:11434` | 用户本地 Ollama 服务地址，正确保留 |

## 4. 修复措施

### 4.1 vite.config.ts — 区分 dev/build 默认值

`build` 模式时 `XLLMAPI_DOCS_URL` 默认 `https://docs.xllmapi.com/docs`，`dev` 模式时默认 `http://localhost:3001/docs`。即使忘记设置环境变量，build 产物也是安全的。

### 4.2 ModelsManagePage.tsx — 动态生成 WebSocket URL

基于 `window.location` 动态计算：`wss://当前域名/ws/node`（HTTPS）或 `ws://当前域名/ws/node`（HTTP）。

### 4.3 platform-service.ts — 移除 localhost fallback

`config.appBaseUrl` 在生产环境已由 `config.ts:122` 强制校验非空，移除 `|| "http://127.0.0.1:3000"` fallback。

## 5. 预防措施

- AGENTS.md 中明确记录：**禁止直接 `npm run build` 后部署线上，必须通过 `deploy.sh`**
- Vite build 模式已内置安全默认值，即使流程出错也不会泄露 localhost
