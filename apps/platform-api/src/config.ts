const envMode = process.env.XLLMAPI_ENV ?? "development";
const isProduction = envMode === "production";
const secretKey = process.env.XLLMAPI_SECRET_KEY ?? null;
const dbDriver = process.env.XLLMAPI_DB_DRIVER ?? "sqlite";
const databaseUrl = process.env.DATABASE_URL ?? null;
const sqliteDbPath = process.env.XLLMAPI_DB_PATH ?? null;
const redisUrl = process.env.REDIS_URL ?? null;

if (isProduction && (!secretKey || secretKey.trim().length === 0)) {
  throw new Error("XLLMAPI_SECRET_KEY is required when XLLMAPI_ENV=production");
}

export const config = {
  envMode,
  isProduction,
  secretKey,
  dbDriver,
  databaseUrl,
  sqliteDbPath,
  redisUrl,
  chatRateLimitPerMinute: Number(process.env.XLLMAPI_CHAT_RATE_LIMIT_PER_MINUTE ?? 60)
};
