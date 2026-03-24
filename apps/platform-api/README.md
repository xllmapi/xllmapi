# @xllmapi/platform-api

Platform API server — HTTP routes, business logic, data persistence, node network management.

## Architecture
- `routes/` — Domain-organized HTTP handlers (auth, chat, provider, admin, market, node, etc.)
- `services/` — Business logic layer
- `repositories/` — Data access (PostgreSQL + SQLite)
- `core/` — Provider executor, node connection manager
- `middleware/` — Security headers, CORS
- `lib/` — HTTP utilities, error handling

## Dependencies
- `@xllmapi/shared-types`, `@xllmapi/core`, `@xllmapi/logger`
- `pg`, `redis`, `ws`

## Run
```bash
./scripts/dev-up.sh
```
