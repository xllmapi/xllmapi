export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5
};

export interface LogContext {
  module?: string;
  requestId?: string;
  userId?: string;
  nodeId?: string;
  [key: string]: unknown;
}

export interface Logger {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
  child(context: LogContext): Logger;
  time(label: string): void;
  timeEnd(label: string): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  module?: string;
  pretty?: boolean; // human-readable vs JSON
}

export function createLogger(options?: LoggerOptions): Logger {
  const minLevel = LEVEL_ORDER[options?.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info'];
  const baseContext: LogContext = {};
  if (options?.module) baseContext.module = options.module;
  const pretty = options?.pretty ?? process.env.NODE_ENV === 'development';
  const timers = new Map<string, number>();

  function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < minLevel) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...baseContext,
      ...context,
    };

    if (pretty) {
      const prefix = `[${entry.module ?? 'app'}]`;
      const lvl = level.toUpperCase().padEnd(5);
      const ctx = context ? ' ' + JSON.stringify(context) : '';
      console.log(`${prefix} ${lvl} ${message}${ctx}`);
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  const logger: Logger = {
    trace: (msg, ctx) => log('trace', msg, ctx),
    debug: (msg, ctx) => log('debug', msg, ctx),
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    fatal: (msg, ctx) => log('fatal', msg, ctx),
    child(childCtx: LogContext): Logger {
      return createLogger({
        level: Object.entries(LEVEL_ORDER).find(([, v]) => v === minLevel)?.[0] as LogLevel,
        module: childCtx.module ?? baseContext.module,
        pretty,
      });
    },
    time(label: string) { timers.set(label, Date.now()); },
    timeEnd(label: string) {
      const start = timers.get(label);
      if (start) {
        timers.delete(label);
        log('debug', `${label}: ${Date.now() - start}ms`);
      }
    },
  };

  return logger;
}
