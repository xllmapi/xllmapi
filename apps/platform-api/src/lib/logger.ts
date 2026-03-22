export function createLogger() {
  const log = (level: "info" | "warn" | "error", msg: string, ctx?: Record<string, unknown>) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: msg,
      ...(ctx ? { context: ctx } : {})
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    info(msg: string, ctx?: Record<string, unknown>) { log("info", msg, ctx); },
    warn(msg: string, ctx?: Record<string, unknown>) { log("warn", msg, ctx); },
    error(msg: string, ctx?: Record<string, unknown>) { log("error", msg, ctx); },
  };
}

export const logger = createLogger();
