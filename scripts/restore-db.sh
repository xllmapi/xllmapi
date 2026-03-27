#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="${1:?Usage: restore-db.sh <backup_file.sql.gz>}"
CONTAINER="${XLLMAPI_PG_CONTAINER:-}"
DB_URL="${DATABASE_URL:-}"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "[restore] ERROR: backup file not found: ${BACKUP_FILE}"
  exit 1
fi

# Verify gzip integrity before restore
if ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
  echo "[restore] ERROR: backup file failed gzip integrity check"
  exit 1
fi

echo "[restore] WARNING: this will overwrite the current database contents"
echo "[restore] backup file: ${BACKUP_FILE}"
read -p "[restore] type 'yes' to continue: " confirm
if [[ "${confirm}" != "yes" ]]; then
  echo "[restore] cancelled"
  exit 0
fi

echo "[restore] restoring from ${BACKUP_FILE}..."

if [[ -n "${CONTAINER}" ]]; then
  gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER}" psql -U xllmapi xllmapi
elif [[ -n "${DB_URL}" ]] && command -v psql &>/dev/null; then
  gunzip -c "${BACKUP_FILE}" | psql "${DB_URL}"
else
  # Auto-detect Docker container
  for name in xllmapi-postgres postgres docker-postgres-1 xllmapi_postgres_1; do
    if docker inspect "${name}" &>/dev/null; then
      CONTAINER="${name}"
      break
    fi
  done
  if [[ -n "${CONTAINER}" ]]; then
    echo "[restore] using Docker container: ${CONTAINER}"
    gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER}" psql -U xllmapi xllmapi
  else
    echo "[restore] ERROR: no psql or Docker container found"
    exit 1
  fi
fi

echo "[restore] done"
