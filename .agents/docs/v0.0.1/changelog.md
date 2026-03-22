# xllmapi v0.0.1 Changelog

## v0.0.1 (2026-03-22)

### Architecture
- Single-process Node.js platform-api replaces previous C++ core-router-executor
- Provider calls (OpenAI, Anthropic, OpenAI-compatible) handled directly in TypeScript
- Circuit breaker, retry with backoff, concurrency limiter, provider fallback
- AES-256-GCM encrypted provider API key storage

### Platform
- Invite-only registration with email verification codes
- Session-based auth + API key auth
- Provider credential management with connectivity validation
- Offering lifecycle: create → admin review → auto-approve → routing
- xtokens settlement system with per-request accounting
- Wallet balance tracking
- Supply and consumption usage analytics
- GitHub-style contribution heatmap (52 weeks, year selector)
- Admin panel: users, invitations, offering reviews, usage dashboard

### Chat
- OpenAI-compatible `/v1/chat/completions` (stream + non-stream)
- Anthropic-compatible `/v1/messages`
- Conversation management with persistent history
- SSE streaming relay with delta forwarding
- Auto-generated conversation titles

### Frontend
- React SPA with dark theme
- Landing page with model marketplace
- User dashboard with overview, API management, consumption tracking
- Chat interface with sidebar, model selector, streaming
- Admin panel with user/invitation/review management
- i18n support (Chinese + English)

### Infrastructure
- PostgreSQL primary storage with migration scripts
- Redis for rate limiting and idempotency cache
- Docker Compose for development
- E2E test suites (MVP flow + sharing flow)
- Vite-built frontend served by platform-api
