# Config Audit & Admin Panel Enhancements

Date: 2026-03-28

## Background

`supplier_reward_rate` was stored in `platform_config` but never read in settlement logic (hardcoded `0.85`). Audit revealed multiple config keys with the same problem. Additionally, admin panel settlement and user tables need more columns.

## Task 1: Settlement records — add `supplier_reward_rate` column

**Problem:** Admin cannot see what reward rate was applied per settlement.

**Changes:**
- DB: New migration `013_settlement_reward_rate.sql` adds `supplier_reward_rate` column to `settlement_records`
- Backend: `recordChatSettlement()` persists the rate used; `getAdminSettlements()` returns it
- Frontend: New column "分成比例" / "Rate" in settlement table

## Task 2: User management — add handle and IP columns

**Problem:** Admin user table doesn't show user handle (`xu-xxx`) or IP address.

**Changes:**
- Backend: `listAdminUsers()` adds last login IP via subquery from `security_events`
- Frontend: New columns for handle and IP address

## Task 3: Config effectiveness audit & fixes

### Audit results

| Config Key | Default | Status |
|---|---|---|
| `supplier_reward_rate` | 0.85 | **FIXED** (was hardcoded) |
| `initial_token_credit` | 1000000 | **NOT USED** — hardcoded as constant |
| `chat_rate_limit_per_minute` | 60 | **NOT USED** — read from env var only |
| `default_invitation_quota` | 5 | OK |
| `min_input_price_per_1k` | 100 | **NOT USED** — no validation |
| `max_input_price_per_1k` | 10000 | **NOT USED** — no validation |
| `min_output_price_per_1k` | 200 | **NOT USED** — no validation |
| `max_output_price_per_1k` | 20000 | **NOT USED** — no validation |
| `default_input_price_per_1k` | — | OK |
| `default_output_price_per_1k` | — | OK |
| `default_max_concurrency` | — | OK |
| `default_daily_token_limit` | — | OK |
| `invitation_enabled` | — | OK |
| `offering_auto_approve` | — | OK |
| `site_banner_*` | — | OK |
| `welcome_message_*` | — | OK |

### Fixes

1. **`initial_token_credit`**: Read from `platform_config` at signup, fallback to `DEFAULT_INITIAL_TOKEN_CREDIT`
2. **`chat_rate_limit_per_minute`**: Read from `platform_config` first, fallback to env var
3. **Price limits**: Validate offering prices against `min/max_input/output_price_per_1k` on create/update
