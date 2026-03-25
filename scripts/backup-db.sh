#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${XLLMAPI_BACKUP_DIR:-/var/backups/xllmapi}"
RETENTION_DAYS="${XLLMAPI_BACKUP_RETENTION:-7}"
DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/xllmapi_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[backup] starting database backup..."
pg_dump "${DB_URL}" | gzip > "${BACKUP_FILE}"
echo "[backup] saved to ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"

echo "[backup] cleaning up backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name "xllmapi_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] done"
