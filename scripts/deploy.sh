#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

RELEASE_ID="${XLLMAPI_RELEASE_ID:-$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)}"
HEALTHCHECK_URL="${XLLMAPI_HEALTHCHECK_URL:-http://127.0.0.1:3000/readyz}"
HEALTHCHECK_TIMEOUT_SECONDS="${XLLMAPI_HEALTHCHECK_TIMEOUT_SECONDS:-30}"
RELEASES_DIR="${XLLMAPI_RELEASES_DIR:-apps/web/releases}"

echo "[deploy] pulling latest code"
git pull origin main

echo "[deploy] installing dependencies"
npm ci

echo "[deploy] building"
XLLMAPI_RELEASE_ID="${RELEASE_ID}" npm run build

echo "[deploy] persisting frontend assets for release ${RELEASE_ID}"
mkdir -p "${RELEASES_DIR}/${RELEASE_ID}"
rm -rf "${RELEASES_DIR:?}/${RELEASE_ID}/assets"
cp -R apps/web/dist/assets "${RELEASES_DIR}/${RELEASE_ID}/assets"

if [[ -d "${RELEASES_DIR}" ]]; then
  mapfile -t old_releases < <(find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d | sort | head -n "-${XLLMAPI_ASSET_RETENTION_COUNT:-3}" 2>/dev/null || true)
  for release_path in "${old_releases[@]}"; do
    [[ -n "${release_path}" ]] || continue
    if [[ "$(basename "${release_path}")" != "${RELEASE_ID}" ]]; then
      rm -rf "${release_path}"
    fi
  done
fi

if [[ -n "${DATABASE_URL:-}" && "${XLLMAPI_SKIP_BACKUP:-0}" != "1" ]]; then
  echo "[deploy] creating pre-migration database backup"
  DATABASE_URL="${DATABASE_URL}" bash scripts/backup-db.sh
fi

echo "[deploy] running database migrations"
DATABASE_URL="${DATABASE_URL}" node apps/platform-api/dist/scripts/apply-postgres-migrations.js

echo "[deploy] reloading pm2 (zero-downtime)"
XLLMAPI_RELEASE_ID="${RELEASE_ID}" pm2 reload infra/pm2.config.cjs --update-env || XLLMAPI_RELEASE_ID="${RELEASE_ID}" pm2 reload xllmapi --update-env

echo "[deploy] verifying readiness"
deadline=$((SECONDS + HEALTHCHECK_TIMEOUT_SECONDS))
until curl -sf "${HEALTHCHECK_URL}" > /dev/null; do
  if (( SECONDS >= deadline )); then
    echo "[deploy] readiness check failed for ${HEALTHCHECK_URL}"
    exit 1
  fi
  sleep 1
done
echo "[deploy] readiness check passed"

echo "[deploy] release ${RELEASE_ID} done"
