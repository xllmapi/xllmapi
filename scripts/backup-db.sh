#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${XLLMAPI_BACKUP_DIR:-/var/backups/xllmapi}"
RETENTION_DAYS="${XLLMAPI_BACKUP_RETENTION:-7}"
DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
CONTAINER="${XLLMAPI_PG_CONTAINER:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/xllmapi_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[backup] starting database backup..."

if [[ -n "${CONTAINER}" ]]; then
  # Docker mode: pg_dump via container
  docker exec "${CONTAINER}" pg_dump -U xllmapi xllmapi | gzip > "${BACKUP_FILE}.tmp"
elif command -v pg_dump &>/dev/null; then
  # Local mode: pg_dump available on host
  pg_dump "${DB_URL}" | gzip > "${BACKUP_FILE}.tmp"
else
  # Auto-detect: try common Docker container names
  for name in xllmapi-postgres postgres docker-postgres-1 opt-postgres-1 xllmapi_postgres_1; do
    if docker inspect "${name}" &>/dev/null; then
      CONTAINER="${name}"
      break
    fi
  done
  if [[ -n "${CONTAINER}" ]]; then
    echo "[backup] using Docker container: ${CONTAINER}"
    docker exec "${CONTAINER}" pg_dump -U xllmapi xllmapi | gzip > "${BACKUP_FILE}.tmp"
  else
    echo "[backup] ERROR: pg_dump not found and no Docker container detected"
    exit 1
  fi
fi

# Verify gzip integrity
if ! gzip -t "${BACKUP_FILE}.tmp" 2>/dev/null; then
  echo "[backup] ERROR: backup file failed gzip integrity check"
  rm -f "${BACKUP_FILE}.tmp"
  exit 1
fi

# Verify backup is not empty
BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}.tmp" 2>/dev/null || stat -f%z "${BACKUP_FILE}.tmp" 2>/dev/null || echo 0)
if (( BACKUP_SIZE < 1024 )); then
  echo "[backup] ERROR: backup too small (${BACKUP_SIZE} bytes), likely empty or failed"
  rm -f "${BACKUP_FILE}.tmp"
  exit 1
fi

# Atomic rename
mv "${BACKUP_FILE}.tmp" "${BACKUP_FILE}"
echo "[backup] saved to ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"

echo "[backup] cleaning up backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name "xllmapi_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] done"
