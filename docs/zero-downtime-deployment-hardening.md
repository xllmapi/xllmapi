# Zero-Downtime Deployment Enhancement Plan

## Context

刚才部署暴露了几个问题：`DATABASE_URL` 未自动读取、`pg_dump` 不在 PATH、`RELEASE_ID` 未传递给 pm2 进程。全面审计 deploy.sh、backup、graceful shutdown、Redis/Postgres 连接管理后，发现以下风险点需要加固。

---

## 1. deploy.sh — 自动读取配置 + 失败回滚

**现状问题：**
- `DATABASE_URL` 必须手动传入，但 `.platform.xllmapi.json` 里已有
- `pg_dump` 不在 PATH（Postgres 跑在 Docker 里）
- 迁移失败或 health check 失败后没有回滚机制
- `RELEASE_ID` 没有正确传递到 pm2 进程环境

**改动：**

```bash
# deploy.sh 开头自动从 .platform.xllmapi.json 读取 DATABASE_URL
if [[ -z "${DATABASE_URL:-}" && -f ".platform.xllmapi.json" ]]; then
  DATABASE_URL=$(node -e "const c=JSON.parse(require('fs').readFileSync('.platform.xllmapi.json','utf8'));console.log(c.database?.url??'')")
  export DATABASE_URL
fi

# 备份使用 docker exec 而不是本地 pg_dump
docker exec xllmapi-postgres pg_dump -U xllmapi xllmapi | gzip > "${BACKUP_FILE}"

# 迁移前记录当前 commit，失败后可回滚
PREV_COMMIT=$(git rev-parse HEAD)
# 迁移失败 → 回滚到 PREV_COMMIT
trap 'echo "[deploy] FAILED — rolling back"; git checkout "${PREV_COMMIT}"; npm run build; pm2 reload ...' ERR

# pm2 reload 确保 RELEASE_ID 生效
XLLMAPI_RELEASE_ID="${RELEASE_ID}" pm2 restart infra/pm2.config.cjs --update-env
```

**文件：** `scripts/deploy.sh`, `scripts/backup-db.sh`

---

## 2. backup-db.sh — Docker 兼容 + 完整性验证

**现状问题：**
- 使用本地 `pg_dump`，但 Postgres 在 Docker 容器内
- 备份后不验证完整性
- 没有恢复流程文档

**改动：**

```bash
# 使用 docker exec 执行 pg_dump
CONTAINER="${XLLMAPI_PG_CONTAINER:-xllmapi-postgres}"
docker exec "${CONTAINER}" pg_dump -U xllmapi xllmapi | gzip > "${BACKUP_FILE}.tmp"

# 验证 gzip 完整性
gzip -t "${BACKUP_FILE}.tmp"
mv "${BACKUP_FILE}.tmp" "${BACKUP_FILE}"

# 验证备份非空
BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}")
if (( BACKUP_SIZE < 1024 )); then
  echo "[backup] ERROR: backup too small (${BACKUP_SIZE} bytes), likely empty"
  exit 1
fi
```

新增 `scripts/restore-db.sh`：
```bash
# 从备份恢复
gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER}" psql -U xllmapi xllmapi
```

**文件：** `scripts/backup-db.sh`, `scripts/restore-db.sh`（新增）

---

## 3. Redis 连接 — 断线重连

**现状问题：**
- Redis 连接失败一次后 `redisClientPromise` 缓存了 null，永不重试
- Redis 断连后整个实例的 rate limit 和 idempotency 退化为内存模式，直到重启

**改动（`apps/platform-api/src/cache.ts`）：**

```typescript
// 连接失败时清除 promise，允许下次重试
try {
  await client.connect();
  return client;
} catch (error) {
  console.error("[cache] redis connect failed", ...);
  redisClientPromise = null;  // ← 允许重试
  return null;
}

// 监听断连事件，重置 promise
client.on("error", (error) => {
  console.error("[cache] redis error", ...);
  if (!client.isOpen) {
    redisClientPromise = null;  // ← 断连后允许重连
  }
});
```

**文件：** `apps/platform-api/src/cache.ts`

---

## 4. Postgres 连接池 — 配置化 + 错误恢复

**现状问题：**
- `new Pool({ connectionString })` 无任何配置，使用默认值（max=10, 无超时）
- 连接池坏了不会自动恢复

**改动（`postgres-platform-repository.ts`）：**

```typescript
pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,                    // 最大连接数
  idleTimeoutMillis: 30000,   // 空闲连接 30s 后释放
  connectionTimeoutMillis: 5000,  // 获取连接超时 5s
});

pool.on("error", (err) => {
  console.error("[db] pool error", err.message);
});
```

**文件：** `apps/platform-api/src/repositories/postgres-platform-repository.ts`

---

## 5. Graceful Shutdown — 排水对齐

**现状问题：**
- 代码中 30s 强制退出 vs PM2 的 35s kill_timeout，时序紧张
- `server.close()` 后没有等待已建立连接完成
- shutdown 中 DB/Redis 关闭是 fire-and-forget，错误被吞

**改动（`apps/platform-api/src/main.ts`）：**

```typescript
// 关闭顺序：停止接新请求 → 等待排水 → 关 DB/Redis → 退出
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  // 1. 停止接新连接
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // 2. 关闭 WebSocket
  nodeConnectionManager.shutdown();

  // 3. 关闭 DB 和 Redis（并行）
  await Promise.allSettled([
    import("./repositories/postgres-platform-repository.js").then(m => m.closePool()),
    cacheService.close()
  ]);

  process.exit(0);
}

// 安全超时兜底（25s，在 PM2 的 35s 之前）
setTimeout(() => process.exit(1), 25_000).unref();
```

**文件：** `apps/platform-api/src/main.ts`

---

## 6. 迁移安全 — 预检 + 干跑

**现状问题：**
- 迁移脚本没有 dry-run 模式
- 不检查 DB 连接是否正常就直接执行
- 没有迁移回滚能力

**改动（`apply-postgres-migrations.ts`）：**

```typescript
// 支持 --dry-run 参数
const dryRun = process.argv.includes("--dry-run");

// 连接前验证
await client.query("SELECT 1");
console.log("[migrations] database connection verified");

// dry-run 模式只列出待执行的迁移
if (dryRun) {
  console.log(`[dry-run] would apply: ${version}`);
  continue;
}
```

**文件：** `apps/platform-api/src/scripts/apply-postgres-migrations.ts`

---

## 7. Smoke Test — Release ID 验证修复

**现状问题：**
- smoke test 检查 `releaseId` 但 pm2 进程可能还在用旧的
- 使用 grep 匹配 JSON，格式敏感

**改动（`scripts/release-smoke.sh`）：**

```bash
# 用 node/jq 解析 JSON 而不是 grep
ACTUAL_ID=$(curl -sf "${BASE_URL}/version" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);process.stdout.write(j.releaseId||'')})")
if [[ -n "${EXPECT_ID}" && "${ACTUAL_ID}" != "${EXPECT_ID}" ]]; then
  echo "[smoke] WARN: releaseId mismatch: expected=${EXPECT_ID} actual=${ACTUAL_ID}"
  # 等待 5s 重试一次（pm2 滚动重启中）
  sleep 5
  ACTUAL_ID=$(curl -sf "${BASE_URL}/version" | ...)
fi
```

**文件：** `scripts/release-smoke.sh`

---

## 8. PM2 配置 — RELEASE_ID 注入

**现状问题：**
- pm2.config.cjs 的 env 中没有 RELEASE_ID
- `pm2 reload --update-env` 不可靠地传递动态环境变量

**改动（`infra/pm2.config.cjs`）：**

```javascript
env: {
  NODE_ENV: "production",
  XLLMAPI_ENV: "production",
  PORT: 3000,
  XLLMAPI_RELEASE_ID: process.env.XLLMAPI_RELEASE_ID || "dev",  // ← 从调用环境继承
},
```

**文件：** `infra/pm2.config.cjs`

---

## 9. 内存缓存 — 防泄漏

**现状问题：**
- `memoryResponseCache` 没有大小上限
- 只在 `getCachedResponse` 时清理过期条目，`setCachedResponse` 不清理

**改动（`cache.ts`）：**

```typescript
const MAX_MEMORY_CACHE_SIZE = 10000;

// setCachedResponse 时也清理 + 检查大小
if (memoryResponseCache.size > MAX_MEMORY_CACHE_SIZE) {
  pruneMemoryCache();
  // 如果清理后仍超限，删除最早的条目
  if (memoryResponseCache.size > MAX_MEMORY_CACHE_SIZE) {
    const firstKey = memoryResponseCache.keys().next().value;
    if (firstKey) memoryResponseCache.delete(firstKey);
  }
}
```

**文件：** `apps/platform-api/src/cache.ts`

---

## Summary — 改动优先级

| # | 改动 | 风险 | 优先级 |
|---|------|------|--------|
| 1 | deploy.sh 自动读取配置 + 回滚 | **高** — 每次部署都要手动传参 | P0 |
| 2 | backup-db.sh Docker 兼容 | **高** — 备份完全失效 | P0 |
| 8 | PM2 配置 RELEASE_ID | **中** — smoke test 每次都失败 | P0 |
| 3 | Redis 断线重连 | **中** — 断连后不恢复 | P1 |
| 4 | Postgres 连接池配置 | **中** — 高负载下可能耗尽连接 | P1 |
| 5 | Graceful shutdown 对齐 | **中** — 时序竞争 | P1 |
| 7 | Smoke test 修复 | **低** — 只影响验收报告 | P1 |
| 6 | 迁移 dry-run | **低** — 安全网 | P2 |
| 9 | 内存缓存防泄漏 | **低** — 长期运行才暴露 | P2 |

## Files to modify

| File | Changes |
|---|---|
| `scripts/deploy.sh` | 自动读取 DB URL、回滚机制、RELEASE_ID 传递 |
| `scripts/backup-db.sh` | Docker exec pg_dump、完整性验证 |
| `scripts/restore-db.sh` | **NEW** — 数据库恢复脚本 |
| `infra/pm2.config.cjs` | env 中加 RELEASE_ID |
| `apps/platform-api/src/cache.ts` | Redis 重连 + 内存缓存上限 |
| `apps/platform-api/src/repositories/postgres-platform-repository.ts` | Pool 配置化 |
| `apps/platform-api/src/main.ts` | Shutdown 时序修复 |
| `apps/platform-api/src/scripts/apply-postgres-migrations.ts` | dry-run + 连接预检 |
| `scripts/release-smoke.sh` | JSON 解析 + 重试 |

## Verification

1. `npm run build` + `npm run test:platform-api` — 全部通过
2. 本地 `./scripts/dev-up.sh` 验证部署流程
3. `bash scripts/backup-db.sh` — 验证 Docker pg_dump 成功
4. `bash scripts/restore-db.sh <backup>` — 验证恢复
5. `node apps/platform-api/dist/scripts/apply-postgres-migrations.js --dry-run` — 验证不执行
6. 停 Redis → 请求 → 恢复 Redis → 验证自动重连
7. SSH 部署到生产 → smoke test 全部通过
