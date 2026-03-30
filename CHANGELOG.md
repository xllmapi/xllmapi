
## 2026-03-30 — Release 674193d-20260330025228

**PR #17** — Circuit breaker 3-tier, unified fallback, failed request recording

### Changes
- Circuit breaker rewrite: transient (30s→10min), degraded (10min→24h), fatal (disabled)
- Chat path unified fallback: passes all candidate offerings, auto-fallback on failure
- Failed requests recorded to api_requests (status='error') for admin visibility
- Error classification: 403 quota → degraded, 403 UA/401 → fatal

### Deploy Info
- Release ID: `674193d-20260330025228`
- Time: 2026-03-30 02:52 UTC+8
- Migrations: none (code-only change)
- PM2 rolling restart, zero downtime
- Smoke test: all passed

---

## 2026-03-30 — Release 6803b92-20260330005317

**PR #16** — Proxy header passthrough, request detail, provider label, security UX

### Changes
- Per-provider custom headers (force/fallback modes, Kimi Coding UA fix)
- Admin request detail panel (IP, UA, settlement breakdown)
- Provider label display (real names instead of "openai_compatible")
- Security page: tab-based password change with email reset
- Supply model aggregation bug fix

### Deploy Info
- Release ID: `6803b92-20260330005317`
- Time: 2026-03-30 00:53 UTC+8
- Migrations: 014_custom_headers, 015_request_context, 016_provider_label
- PM2 rolling restart, zero downtime
- Smoke test: all passed

---

## 2026-03-29 — Release b01246a-20260328235451

**PR #15** — Branded email layout

### Changes
- All transactional emails wrapped in brand layout (blue bar + footer)
- Footer: website, GitHub, QQ group, forum links

### Deploy Info
- Release ID: `b01246a-20260328235451`
- Time: 2026-03-29 23:54 UTC+8
- Migrations: none

## 2026-03-30 — Release 8a5fb06-20260330032627

**PR #18** — Admin node health page, system log viewer

### Changes
- Node Health page: view/reset/stop offerings with circuit breaker status
- System Log viewer: PM2 log reading with level filter and keyword search
- Sidebar: new "模型节点" section (Reviews + Node Health)

### Deploy Info
- Release ID: `8a5fb06-20260330032627`
- Time: 2026-03-30 03:26 UTC+8
- Migrations: none
- PM2 rolling restart, zero downtime
- Smoke test: all passed

## 2026-03-30 — Release 6a1d17c-20260330041937

**PR #19** — Log viewer fix, circuit breaker misrecovery bug, fallback tracking

### Changes
- Log viewer: merge out.log + error.log, parse PM2 timestamp format
- Bug fix: recordRouteResult misrecovery — failed offering circuit breaker was wrongly reset after fallback success
- Fallback tracking: failedAttempts written to response_body for admin visibility

### Deploy Info
- Release ID: `6a1d17c-20260330041937`
- Time: 2026-03-30 04:19 UTC+8
- Migrations: none
- PM2 rolling restart, zero downtime
- Smoke test: all passed

## 2026-03-30 — Release 3b58ce9-20260330044845

**PR #20** — Hotfix batch: log multiline, node health classification, last_used_at

### Changes
- Log viewer: multi-line stack traces merged into single entries; error.log defaults to error level
- Node health page: stopped offerings no longer shown as unhealthy
- Fix: removed non-existent `last_used_at` column from node_tokens query (constant SQL errors)

### Deploy Info
- Release ID: `3b58ce9-20260330044845`
- Time: 2026-03-30 04:48 UTC+8
- Migrations: none
- Backup: enabled (removed XLLMAPI_SKIP_BACKUP)
- PM2 rolling restart, zero downtime
- Smoke test: all passed

## 2026-03-30 — Release 411596b-20260330072624

**PR #21** — Remaining fixes batch

### Changes
- Request detail: fallback attempts visible in detail panel
- Chat error fix: SSE `event: error` now properly displayed to users
- Format tracking: client_format, upstream_format, format_converted per request (migration 017)
- Node health page: rewritten with tabs (All/Healthy/Stopped/Unhealthy), search, pagination, expandable detail
- Releases page: new admin page for deployment history

### Deploy Info
- Release ID: `411596b-20260330072624`
- Time: 2026-03-30 07:26 UTC+8
- Migrations: 017_request_format
- Backup: enabled
- PM2 rolling restart, zero downtime
- Smoke test: all passed

## 2026-03-30 — Release 296bdcb-20260330150333

**PR #22** — Model node + API key management UX overhaul

### Changes
- API Key page: two sections (Platform Keys + Model Node Keys), test connectivity, cascade delete
- Node management: "停用" button + "历史记录" archive section
- Text: "接入新模型" → "创建模型节点"
- API key creation limit: configurable max (default 5)

### Deploy Info
- Release ID: `296bdcb-20260330150333`
- Time: 2026-03-30 15:03 UTC+8
- Migrations: 018_key_preview_and_archive
- Backup: enabled
- PM2 rolling restart, zero downtime
- Smoke test: all passed
