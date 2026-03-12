#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${XLLMAPI_DEV_LOG_DIR:-/tmp/xllmapi-dev}"
mkdir -p "${LOG_DIR}"

echo "[xllmapi] starting postgres + redis (docker compose)"
docker compose -f "${ROOT_DIR}/infra/docker/docker-compose.yml" up -d postgres redis

echo "[xllmapi] building platform-api and applying postgres migrations"
(
  cd "${ROOT_DIR}"
  DATABASE_URL="${DATABASE_URL:-postgresql://xllmapi:xllmapi@127.0.0.1:5432/xllmapi}" npm run build:platform-api >/dev/null
  DATABASE_URL="${DATABASE_URL:-postgresql://xllmapi:xllmapi@127.0.0.1:5432/xllmapi}" node apps/platform-api/dist/scripts/apply-postgres-migrations.js >/dev/null
)

if ss -ltn | grep -q ':4001 '; then
  echo "[xllmapi] core-router-executor already running on :4001"
else
  CORE_BIN="${ROOT_DIR}/apps/core-router-executor/build/linux/x86_64/release/core-router-executor"
  if [[ ! -x "${CORE_BIN}" ]]; then
    echo "[xllmapi] core binary not found, building with xmake"
    (cd "${ROOT_DIR}/apps/core-router-executor" && xmake build -y)
  fi
  echo "[xllmapi] starting core-router-executor"
  nohup env \
    XLLMAPI_ENV=development \
    XLLMAPI_SECRET_KEY="${XLLMAPI_SECRET_KEY:-local-dev-secret}" \
    "${CORE_BIN}" > "${LOG_DIR}/core.log" 2>&1 &
  echo $! > "${LOG_DIR}/core.pid"
fi

if ss -ltn | grep -q ':3000 '; then
  echo "[xllmapi] platform-api already running on :3000"
else
  echo "[xllmapi] starting platform-api server on :3000"
  nohup env \
    XLLMAPI_ENV=development \
    XLLMAPI_SECRET_KEY="${XLLMAPI_SECRET_KEY:-local-dev-secret}" \
    XLLMAPI_DB_DRIVER=postgres \
    DATABASE_URL="${DATABASE_URL:-postgresql://xllmapi:xllmapi@127.0.0.1:5432/xllmapi}" \
    REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}" \
    CORE_BASE_URL="${CORE_BASE_URL:-http://127.0.0.1:4001}" \
    XLLMAPI_DEEPSEEK_API_KEY="${XLLMAPI_DEEPSEEK_API_KEY:-}" \
    node "${ROOT_DIR}/apps/platform-api/dist/main.js" > "${LOG_DIR}/platform.log" 2>&1 &
  echo $! > "${LOG_DIR}/platform.pid"
fi

echo "[xllmapi] done"
echo "Web: http://127.0.0.1:3000"
echo "Auth page: http://127.0.0.1:3000/auth"
echo "Admin seed email: admin_demo@xllmapi.local"
echo "User seed email: user_demo@xllmapi.local"
echo "Log files: ${LOG_DIR}/core.log ${LOG_DIR}/platform.log"
