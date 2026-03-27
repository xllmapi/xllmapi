#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# Auto-load DATABASE_URL from .platform.xllmapi.json if not set
if [[ -z "${DATABASE_URL:-}" && -f ".platform.xllmapi.json" ]]; then
  DATABASE_URL=$(node -e "const c=JSON.parse(require('fs').readFileSync('.platform.xllmapi.json','utf8'));console.log(c.database?.url??'')")
  if [[ -n "${DATABASE_URL}" ]]; then
    export DATABASE_URL
    echo "[deploy] loaded DATABASE_URL from .platform.xllmapi.json"
  fi
fi

RELEASE_ID="${XLLMAPI_RELEASE_ID:-$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)}"
HEALTHCHECK_URL="${XLLMAPI_HEALTHCHECK_URL:-http://127.0.0.1:3000/readyz}"
HEALTHCHECK_TIMEOUT_SECONDS="${XLLMAPI_HEALTHCHECK_TIMEOUT_SECONDS:-60}"
RELEASES_DIR="${XLLMAPI_RELEASES_DIR:-apps/web/releases}"

# Record current commit for rollback
PREV_COMMIT=$(git rev-parse HEAD)

rollback_() {
  echo "[deploy] FAILED — rolling back to ${PREV_COMMIT}"
  git checkout "${PREV_COMMIT}" 2>/dev/null || true
  npm run build 2>/dev/null || true
  XLLMAPI_RELEASE_ID="${PREV_COMMIT}" pm2 reload infra/pm2.config.cjs --update-env 2>/dev/null || true
  echo "[deploy] rollback completed"
}

echo "[deploy] release ${RELEASE_ID}"

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

# Clean up old releases (keep last N)
if [[ -d "${RELEASES_DIR}" ]]; then
  mapfile -t old_releases < <(find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d | sort | head -n "-${XLLMAPI_ASSET_RETENTION_COUNT:-3}" 2>/dev/null || true)
  for release_path in "${old_releases[@]}"; do
    [[ -n "${release_path}" ]] || continue
    if [[ "$(basename "${release_path}")" != "${RELEASE_ID}" ]]; then
      rm -rf "${release_path}"
    fi
  done
fi

# Database backup (skip with XLLMAPI_SKIP_BACKUP=1)
if [[ -n "${DATABASE_URL:-}" && "${XLLMAPI_SKIP_BACKUP:-0}" != "1" ]]; then
  echo "[deploy] creating pre-migration database backup"
  DATABASE_URL="${DATABASE_URL}" bash scripts/backup-db.sh
fi

echo "[deploy] running database migrations"
if ! node apps/platform-api/dist/scripts/apply-postgres-migrations.js; then
  echo "[deploy] ERROR: migration failed"
  rollback_
  exit 1
fi

echo "[deploy] reloading pm2 (zero-downtime rolling restart)"
XLLMAPI_RELEASE_ID="${RELEASE_ID}" pm2 reload infra/pm2.config.cjs --update-env || XLLMAPI_RELEASE_ID="${RELEASE_ID}" pm2 reload xllmapi --update-env

echo "[deploy] verifying readiness"
deadline=$((SECONDS + HEALTHCHECK_TIMEOUT_SECONDS))
until curl -sf "${HEALTHCHECK_URL}" > /dev/null; do
  if (( SECONDS >= deadline )); then
    echo "[deploy] ERROR: readiness check failed for ${HEALTHCHECK_URL} after ${HEALTHCHECK_TIMEOUT_SECONDS}s"
    rollback_
    exit 1
  fi
  sleep 2
done
echo "[deploy] readiness check passed"

# Smoke test (optional, runs if release-smoke.sh exists)
if [[ -f scripts/release-smoke.sh ]]; then
  echo "[deploy] running smoke test"
  XLLMAPI_EXPECT_RELEASE_ID="${RELEASE_ID}" bash scripts/release-smoke.sh
fi

echo "[deploy] release ${RELEASE_ID} done"
