#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${XLLMAPI_DEV_LOG_DIR:-/tmp/xllmapi-dev}"

if [[ -f "${LOG_DIR}/platform.pid" ]]; then
  pid="$(cat "${LOG_DIR}/platform.pid")"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${LOG_DIR}/platform.pid"
fi

docker compose -f "${ROOT_DIR}/infra/docker/docker-compose.yml" stop postgres redis >/dev/null 2>&1 || true

echo "[xllmapi] stopped local dev services (platform + postgres/redis)"
