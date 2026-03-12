# xllmapi Data Model

## Core tables

- `users`
- `platform_api_keys`
- `wallets`
- `ledger_entries`
- `provider_accounts`
- `provider_credentials`
- `logical_models`
- `offerings`
- `api_requests`
- `usage_records`
- `settlement_records`
- `risk_events`

## Ledger rules

- append-only
- 按 `request_id` 做幂等
- 无 usage 默认不扣费
- 冲正通过反向流水
