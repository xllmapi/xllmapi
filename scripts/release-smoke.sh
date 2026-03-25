#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${XLLMAPI_SMOKE_BASE_URL:-http://127.0.0.1:3000}"
TIMEOUT_SECONDS="${XLLMAPI_SMOKE_TIMEOUT_SECONDS:-60}"
EXPECT_RELEASE_ID="${XLLMAPI_EXPECT_RELEASE_ID:-}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

wait_for_ok_() {
  local path="$1"
  local url="${BASE_URL}${path}"
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  until curl -fsS "${url}" > /dev/null; do
    if (( SECONDS >= deadline )); then
      echo "[smoke] probe failed: ${url}" >&2
      exit 1
    fi
    sleep 1
  done
  echo "[smoke] ok ${path}"
}

assert_http_status_() {
  local path="$1"
  local expected_status="$2"
  local body_file="${tmp_dir}/body.$$.tmp"
  local actual_status
  actual_status="$(curl -sS -o "${body_file}" -w '%{http_code}' "${BASE_URL}${path}")"
  if [[ "${actual_status}" != "${expected_status}" ]]; then
    echo "[smoke] expected ${expected_status} for ${path}, got ${actual_status}" >&2
    cat "${body_file}" >&2 || true
    exit 1
  fi
  echo "[smoke] status ${expected_status} ${path}"
}

assert_body_contains_() {
  local path="$1"
  local pattern="$2"
  local body_file="${tmp_dir}/body.$$.tmp"
  curl -fsS "${BASE_URL}${path}" > "${body_file}"
  if ! grep -Eq "${pattern}" "${body_file}"; then
    echo "[smoke] expected body from ${path} to contain pattern: ${pattern}" >&2
    cat "${body_file}" >&2 || true
    exit 1
  fi
  echo "[smoke] body matched ${path}: ${pattern}"
}

wait_for_ok_ "/healthz"
wait_for_ok_ "/readyz"

assert_body_contains_ "/version" '"ok"[[:space:]]*:[[:space:]]*true'
assert_body_contains_ "/version" '"releaseId"[[:space:]]*:'
if [[ -n "${EXPECT_RELEASE_ID}" ]]; then
  assert_body_contains_ "/version" "\"releaseId\"[[:space:]]*:[[:space:]]*\"${EXPECT_RELEASE_ID}\""
fi

assert_body_contains_ "/" '<div id="root">'
assert_http_status_ "/assets/__xllmapi_missing__.js" "404"
assert_body_contains_ "/metrics" 'xllmapi_total_requests'

echo "[smoke] release smoke passed for ${BASE_URL}"
