import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function loadConfigFile(): Record<string, unknown> {
  const argIdx = process.argv.indexOf("--config");
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    try { return JSON.parse(readFileSync(process.argv[argIdx + 1], "utf-8")); }
    catch (e) { throw new Error(`Failed to load config file: ${process.argv[argIdx + 1]}: ${e}`); }
  }
  const paths = [
    join(process.cwd(), ".platform.xllmapi.json"),
    join(homedir(), ".config", "xllmapi", ".platform.xllmapi.json"),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, "utf-8")); }
      catch { /* skip invalid files */ }
    }
  }
  return {};
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((o: unknown, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

const fileConfig = loadConfigFile();

/** Get config value: env var > config file > default */
function configVal(envKey: string, filePath: string, fallback?: string): string | undefined {
  return process.env[envKey] ?? (getNestedValue(fileConfig, filePath) as string | undefined) ?? fallback;
}

const ALLOWED_DB_DRIVERS = new Set(["sqlite", "postgres"]);
const ALLOWED_EMAIL_PROVIDERS = new Set(["mock", "resend"]);

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

const parseBoolean = (name: string, fallback: boolean) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be a boolean`);
};

const envMode = configVal("XLLMAPI_ENV", "env", "development")!;
const isProduction = envMode === "production";
const secretKey = configVal("XLLMAPI_SECRET_KEY", "secretKey") ?? null;
const dbDriver = configVal("XLLMAPI_DB_DRIVER", "database.driver", "sqlite")!;
const databaseUrl = configVal("DATABASE_URL", "database.url") ?? null;
const sqliteDbPath = configVal("XLLMAPI_DB_PATH", "database.sqlitePath") ?? null;
const redisUrl = configVal("REDIS_URL", "redis.url") ?? null;
const corsOrigins = process.env.XLLMAPI_CORS_ORIGINS
  ? parseCsv(process.env.XLLMAPI_CORS_ORIGINS)
  : Array.isArray(getNestedValue(fileConfig, "cors.origins"))
    ? (getNestedValue(fileConfig, "cors.origins") as string[])
    : [];
const releaseId = (configVal("XLLMAPI_RELEASE_ID", "releaseId", "dev") ?? "dev").trim() || "dev";
const emailProvider = (configVal("XLLMAPI_EMAIL_PROVIDER", "email.provider", isProduction ? "resend" : "mock") ?? "mock").trim().toLowerCase();
const appBaseUrl = (configVal("XLLMAPI_APP_BASE_URL", "appBaseUrl", "") ?? "").trim().replace(/\/+$/, "");
const emailFrom = (configVal("XLLMAPI_EMAIL_FROM", "email.from", "") ?? "").trim();
const emailReplyTo = (configVal("XLLMAPI_EMAIL_REPLY_TO", "email.replyTo", "") ?? "").trim() || null;
const resendApiKey = (configVal("XLLMAPI_RESEND_API_KEY", "email.resendApiKey", "") ?? "").trim() || null;

if (!ALLOWED_DB_DRIVERS.has(dbDriver)) {
  throw new Error(`XLLMAPI_DB_DRIVER must be one of: ${Array.from(ALLOWED_DB_DRIVERS).join(", ")}`);
}

if (!ALLOWED_EMAIL_PROVIDERS.has(emailProvider)) {
  throw new Error(`XLLMAPI_EMAIL_PROVIDER must be one of: ${Array.from(ALLOWED_EMAIL_PROVIDERS).join(", ")}`);
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

if (isProduction && appBaseUrl.length === 0) {
  throw new Error("XLLMAPI_APP_BASE_URL is required when XLLMAPI_ENV=production");
}

if (isProduction && emailFrom.length === 0) {
  throw new Error("XLLMAPI_EMAIL_FROM is required when XLLMAPI_ENV=production");
}

if (isProduction && emailProvider === "resend" && (!resendApiKey || resendApiKey.length === 0)) {
  throw new Error("XLLMAPI_RESEND_API_KEY is required when XLLMAPI_EMAIL_PROVIDER=resend in production");
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
  appBaseUrl,
  emailProvider,
  emailFrom,
  emailReplyTo,
  resendApiKey,
  chatRateLimitPerMinute: parsePositiveInt("XLLMAPI_CHAT_RATE_LIMIT_PER_MINUTE", 60),
  authRequestCodeLimitPerMinute: parsePositiveInt("XLLMAPI_AUTH_REQUEST_CODE_LIMIT_PER_MINUTE", 5),
  authVerifyCodeLimitPerMinute: parsePositiveInt("XLLMAPI_AUTH_VERIFY_CODE_LIMIT_PER_MINUTE", 10),
  authPasswordLoginLimitPerMinute: parsePositiveInt("XLLMAPI_AUTH_PASSWORD_LOGIN_LIMIT_PER_MINUTE", 10),
  requestBodyMaxBytes: parsePositiveInt("XLLMAPI_REQUEST_BODY_MAX_BYTES", 1_048_576),
  assetRetentionCount: parsePositiveInt("XLLMAPI_ASSET_RETENTION_COUNT", 3),
  sessionCookieName: configVal("XLLMAPI_SESSION_COOKIE_NAME", "session.cookieName", "xllmapi_session")?.trim() || "xllmapi_session",
  sessionMaxAgeSeconds: parsePositiveInt("XLLMAPI_SESSION_MAX_AGE_SECONDS", 30 * 24 * 60 * 60),
  authCodeTtlSeconds: parsePositiveInt("XLLMAPI_AUTH_CODE_TTL_SECONDS", 10 * 60),
  passwordResetTtlSeconds: parsePositiveInt("XLLMAPI_PASSWORD_RESET_TTL_SECONDS", 30 * 60),
  emailChangeTtlSeconds: parsePositiveInt("XLLMAPI_EMAIL_CHANGE_TTL_SECONDS", 30 * 60),
  emailSendCooldownSeconds: parsePositiveInt("XLLMAPI_EMAIL_SEND_COOLDOWN_SECONDS", 60),
  securityNotifyEmailEnabled: parseBoolean("XLLMAPI_SECURITY_NOTIFY_EMAIL_ENABLED", true)
};
