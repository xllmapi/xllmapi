# xllmapi Backend API Gaps v1

## Existing base

- `GET /v1/models`
- `POST /v1/chat/completions`
- `GET /v1/wallet`
- provider credential CRUD
- offering CRUD
- admin pending offering review

## Added in current plan

- `POST /v1/auth/request-code`
- `POST /v1/auth/verify-code`
- `GET /v1/me`
- `GET /v1/me/invitation-stats`
- `GET /v1/invitations`
- `POST /v1/invitations`
- `POST /v1/invitations/:id/revoke`
- `GET /v1/admin/users`
- `GET /v1/admin/invitations`
- `POST /v1/admin/invitations`
- `GET /v1/public/users/:handle`
- `GET /v1/public/users/:handle/offerings`
- `GET /v1/usage/supply`
- `GET /v1/usage/consumption`
- `GET /v1/admin/usage`
- `GET /v1/admin/market/summary`
- `POST /v1/messages`

