# @xllmapi/core

Core execution engine — provider streaming, resilience patterns, context management.

## Modules
- `providers/` — OpenAI and Anthropic streaming providers + SSE parser
- `resilience/` — Circuit breaker, retry with backoff
- `executor/` — Concurrency limiter
- `context/` — Context window management, thinking content stripping

## Key Exports
- `streamOpenAI`, `callOpenAI`, `streamAnthropic`, `callAnthropic`
- `CircuitBreaker`, `withRetry`, `ConcurrencyLimiter`
- `trimToContextWindow`, `stripThinking`, `MODEL_CONTEXT_LIMITS`
- `parseSseStream`

## Dependencies
- `@xllmapi/shared-types`
- `@xllmapi/logger`
