# 零停机发布导致前端白屏 — 分析报告 + 优化方案

## Context

2026-03-31 部署 fix/negative-balance-vulnerability 后，用户访问 https://xllmapi.com 出现白屏。浏览器控制台显示所有 `/_releases/{releaseId}/assets/*` 资源返回 404（JSON 格式），CSS 返回 `application/json` MIME type。

---

## 一、故障时间线

```
15:02:54  deploy.sh 开始，生成 releaseId = ef2889e-20260331150254
15:03:00  git pull + npm ci + npm run build 完成
15:03:01  assets 持久化到 apps/web/releases/ef2889e-20260331150254/
15:03:02  旧版本 releases 清理（保留最近 3 个）
15:03:10  pm2 reload 开始滚动重启 2 个 worker
15:03:10~ Worker 0 开始重启，Worker 1 仍在运行（旧代码 + 旧 releaseId）
15:03:25  ← 用户请求命中 Worker 1（旧），所有 /_releases/ef2889e-.../assets/* 返回 404
15:03:25  Cloudflare NRT 边缘节点缓存了这些 404 响应
15:03:30~ Worker 1 完成重启，新代码生效
15:05:00  从服务器内部 curl 验证正常（200），但用户浏览器仍看到缓存的 404
15:13:14  重新部署生成新 releaseId = c73271b-20260331151314，问题解决
```

---

## 二、根因分析

### 根因 1：pm2 reload 滚动重启的竞态窗口

`pm2 reload` 逐个重启 worker。在窗口期内：
- **旧 worker** 的 `config.releaseId` = 上一次部署的 ID（或 `dev`）
- **新 worker** 的 `config.releaseId` = 本次部署的 ID

当旧 worker 收到对新 releaseId 的资源请求时：

```
main.ts:117  existsSync(releases/{NEW_ID}/assets/xxx.js) → true ✓（文件已持久化）
```

**理论上应该返回 200**，因为 `read_release_asset_file_` 先检查持久化目录（line 117），这不依赖 `config.releaseId`。

但实际日志显示返回了 404。进一步分析发现：

### 根因 2：404 响应缺少 Cache-Control 头

**关键代码** — `main.ts:300-326`：
```typescript
const staticFile = req.method === "GET" ? read_static_file_(url.pathname) : null;
if (staticFile) {
  if (staticFile.statusCode === 404) {
    // ← 返回 JSON 404，没有设置 cache-control!
    send_json_(res, 404, { error: { message: "Not found", requestId } });
    return;
  }
  // ... 200 时设置 cache-control: immutable
  headers["cache-control"] = "public, max-age=31536000, immutable";
}
```

问题链条：
1. 旧 worker 在某个瞬间对 `/_releases/{NEW_ID}/assets/xxx.js` 返回了 404
2. 404 响应**没有 `cache-control: no-store` 或 `no-cache`**
3. Cloudflare 按默认策略缓存了这个 404 响应
4. 后续所有经过该 Cloudflare 边缘节点的请求都命中了缓存的 404
5. 即使 Node 服务器已恢复正常，用户仍然看到 404

### 根因 3：CSP 阻止 Google Fonts（次要）

`security.ts` 中 CSP 设置了 `style-src 'self' 'unsafe-inline'`，阻止了 Google Fonts 的外部样式表加载。这不是白屏的直接原因，但加剧了页面显示异常。

---

## 三、影响范围

| 维度 | 详情 |
|------|------|
| **影响时长** | 约 10 分钟（从 15:03 到手动重新部署） |
| **影响用户** | 经过 Cloudflare NRT 边缘节点的用户 |
| **影响程度** | 页面完全白屏，所有功能不可用 |
| **恢复方式** | 重新部署生成新 releaseId 绕过被污染的缓存 |

---

## 四、优化方案

### 改动 1：资源 404 响应添加 no-cache 头（核心修复）

**文件**: `apps/platform-api/src/main.ts:303-309`

当 `/_releases/` 或 `/assets/` 路径返回 404 时，必须设置 `cache-control: no-store`，防止 CDN 缓存 404 响应。

```typescript
if (staticFile.statusCode === 404) {
  const headers: Record<string, string> = {
    "cache-control": "no-store",  // ← 新增：防止 CDN 缓存 404
  };
  res.writeHead(404, headers);
  res.end(JSON.stringify({ error: { message: "Not found", requestId } }));
  return;
}
```

### 改动 2：deploy.sh 延迟清理旧 release assets

**文件**: `scripts/deploy.sh:48-57`

当前 `XLLMAPI_ASSET_RETENTION_COUNT` 默认保留 3 个版本，但清理发生在 pm2 reload **之前**。如果旧 worker 仍在服务旧 releaseId 的请求，对应的资源已被删除。

修改为：增加保留数量到 5，并在 pm2 reload **之后**执行清理。

### 改动 3：CSP 允许 Google Fonts（次要优化）

**文件**: `apps/platform-api/src/middleware/security.ts`

在 `style-src` 和 `font-src` 中添加 `https://fonts.googleapis.com` 和 `https://fonts.gstatic.com`：
```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
font-src 'self' data: https://fonts.gstatic.com
```

### 改动 4：smoke test 增加资源可达性验证

**文件**: `scripts/release-smoke.sh`

在 smoke test 中增加对新 release 资源的实际 HTTP 请求验证（不只检查 releaseId 匹配）。

---

## 五、涉及文件

| 文件 | 改动内容 |
|------|----------|
| `apps/platform-api/src/main.ts:303-309` | 404 响应添加 `cache-control: no-store` |
| `scripts/deploy.sh:48-57` | 延迟清理 + 增加保留数量 |
| `apps/platform-api/src/middleware/security.ts:12-22` | CSP 允许 Google Fonts |
| `scripts/release-smoke.sh` | 增加资源可达性验证 |

---

## 六、验证方式

1. 本地构建验证 `npm run build` 通过
2. 单元测试 `npm run test:platform-api` 无回归
3. 手动验证：模拟 404 响应检查 `cache-control: no-store` 头
4. 部署到生产后，检查 Cloudflare 不再缓存 404 响应（`cf-cache-status` 不为 HIT）
5. 二次部署验证新旧 release 切换无白屏

---

## 七、结论

**本次故障不是代码改动导致的，而是部署流程中的固有缺陷。** 核心问题是资源 404 响应缺少 `cache-control: no-store`，导致 CDN 在 pm2 滚动重启的短暂窗口内缓存了错误的 404 响应。只要修复 404 的缓存头，即使滚动重启窗口内产生了短暂 404，也不会被 CDN 持久化缓存，用户刷新即可恢复。
