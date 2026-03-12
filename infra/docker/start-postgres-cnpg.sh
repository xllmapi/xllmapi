#!/usr/bin/env bash
set -euo pipefail

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
POSTGRES_USER="${POSTGRES_USER:-xllmapi}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-xllmapi}"
POSTGRES_DB="${POSTGRES_DB:-xllmapi}"
PG_BIN="/usr/lib/postgresql/17/bin"

mkdir -p "${PGDATA}"
chown -R postgres:postgres /var/lib/postgresql

run_as_postgres() {
  su postgres -s /bin/bash -c "$1"
}

if [ ! -s "${PGDATA}/PG_VERSION" ]; then
  pwfile="/var/lib/postgresql/.pwfile"
  printf '%s' "${POSTGRES_PASSWORD}" > "${pwfile}"
  chown postgres:postgres "${pwfile}"
  chmod 600 "${pwfile}"
  run_as_postgres "${PG_BIN}/initdb -D '${PGDATA}' -U '${POSTGRES_USER}' --auth-host=scram-sha-256 --auth-local=trust --pwfile='${pwfile}'"
  rm -f "${pwfile}"

  {
    echo "listen_addresses='*'"
    echo "port=5432"
  } >> "${PGDATA}/postgresql.conf"
  {
    echo "host all all 0.0.0.0/0 scram-sha-256"
    echo "host all all ::/0 scram-sha-256"
  } >> "${PGDATA}/pg_hba.conf"

  run_as_postgres "${PG_BIN}/pg_ctl -D '${PGDATA}' -w start"
  if ! run_as_postgres "${PG_BIN}/psql --username '${POSTGRES_USER}' --dbname postgres -tAc \"SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}'\"" | grep -q 1; then
    run_as_postgres "${PG_BIN}/createdb --username '${POSTGRES_USER}' '${POSTGRES_DB}'"
  fi
  run_as_postgres "${PG_BIN}/pg_ctl -D '${PGDATA}' -m fast -w stop"
fi

exec su postgres -s /bin/bash -c "${PG_BIN}/postgres -D '${PGDATA}'"
