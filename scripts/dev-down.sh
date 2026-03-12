#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${XLLMAPI_DEV_LOG_DIR:-/tmp/xllmapi-dev}"

for file in "${LOG_DIR}/platform.pid" "${LOG_DIR}/core.pid"; do
  if [[ -f "${file}" ]]; then
    pid="$(cat "${file}")"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
    rm -f "${file}"
  fi
done

docker compose -f "${ROOT_DIR}/infra/docker/docker-compose.yml" stop postgres redis >/dev/null 2>&1 || true

echo "[xllmapi] stopped local dev services (platform/core + postgres/redis)"
