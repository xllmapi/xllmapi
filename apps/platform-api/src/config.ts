const ALLOWED_DB_DRIVERS = new Set(["sqlite", "postgres"]);

const parsePositiveInt = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const parseCsv = (raw: string | undefined) =>
  (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const envMode = process.env.XLLMAPI_ENV ?? "development";
const isProduction = envMode === "production";
const secretKey = process.env.XLLMAPI_SECRET_KEY ?? null;
const dbDriver = process.env.XLLMAPI_DB_DRIVER ?? "sqlite";
const databaseUrl = process.env.DATABASE_URL ?? null;
const sqliteDbPath = process.env.XLLMAPI_DB_PATH ?? null;
const redisUrl = process.env.REDIS_URL ?? null;
const corsOrigins = parseCsv(process.env.XLLMAPI_CORS_ORIGINS);
const releaseId = (process.env.XLLMAPI_RELEASE_ID ?? "dev").trim() || "dev";

if (!ALLOWED_DB_DRIVERS.has(dbDriver)) {
  throw new Error(`XLLMAPI_DB_DRIVER must be one of: ${Array.from(ALLOWED_DB_DRIVERS).join(", ")}`);
}

if (isProduction && (!secretKey || secretKey.trim().length === 0)) {
  throw new Error("XLLMAPI_SECRET_KEY is required when XLLMAPI_ENV=production");
}

if (isProduction && dbDriver !== "postgres") {
  throw new Error("XLLMAPI_DB_DRIVER must be postgres in production");
}

if (isProduction && (!databaseUrl || databaseUrl.trim().length === 0)) {
  throw new Error("DATABASE_URL is required when XLLMAPI_ENV=production");
}

if (isProduction && (!redisUrl || redisUrl.trim().length === 0)) {
  throw new Error("REDIS_URL is required when XLLMAPI_ENV=production");
}

if (isProduction && corsOrigins.length === 0) {
  throw new Error("XLLMAPI_CORS_ORIGINS is required when XLLMAPI_ENV=production");
}

export const config = {
  envMode,
  isProduction,
  secretKey,
  dbDriver,
  databaseUrl,
  sqliteDbPath,
  redisUrl,
  corsOrigins,
  releaseId,
  chatRateLimitPerMinute: parsePositiveInt("XLLMAPI_CHAT_RATE_LIMIT_PER_MINUTE", 60),
  authRequestCodeLimitPerMinute: parsePositiveInt("XLLMAPI_AUTH_REQUEST_CODE_LIMIT_PER_MINUTE", 5),
  authVerifyCodeLimitPerMinute: parsePositiveInt("XLLMAPI_AUTH_VERIFY_CODE_LIMIT_PER_MINUTE", 10),
  authPasswordLoginLimitPerMinute: parsePositiveInt("XLLMAPI_AUTH_PASSWORD_LOGIN_LIMIT_PER_MINUTE", 10),
  requestBodyMaxBytes: parsePositiveInt("XLLMAPI_REQUEST_BODY_MAX_BYTES", 1_048_576),
  assetRetentionCount: parsePositiveInt("XLLMAPI_ASSET_RETENTION_COUNT", 3),
  sessionCookieName: process.env.XLLMAPI_SESSION_COOKIE_NAME?.trim() || "xllmapi_session",
  sessionMaxAgeSeconds: parsePositiveInt("XLLMAPI_SESSION_MAX_AGE_SECONDS", 30 * 24 * 60 * 60)
};
