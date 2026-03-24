# @xllmapi/logger

Unified structured logging library for all xllmapi sub-projects.

## Features
- Log levels: TRACE, DEBUG, INFO, WARN, ERROR, FATAL
- Structured JSON output (production) / Pretty print (development)
- Module tagging via `child()`
- Performance timing via `time()` / `timeEnd()`
- Environment variable control: `LOG_LEVEL=debug`

## Usage
```typescript
import { createLogger } from '@xllmapi/logger';
const log = createLogger({ module: 'chat' });
log.info('request started', { requestId: '123', model: 'deepseek-chat' });
```

## Dependencies
None
