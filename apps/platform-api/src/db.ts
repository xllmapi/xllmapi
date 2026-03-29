import { mkdirSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  CandidateOffering,
  InvitationStats,
  LogicalModel,
  MeProfile,
  PricingMode,
  PublicMarketModel,
  PublicSupplierOffering,
  PublicSupplierProfile
} from "@xllmapi/shared-types";
import { config } from "./config.js";
import { DEFAULT_AVATAR_URL, DEFAULT_INITIAL_TOKEN_CREDIT, DEV_ADMIN_API_KEY, DEV_USER_API_KEY } from "./constants.js";
import { encryptSecret, hashApiKey, hashPassword, passwordNeedsRehash, verifyPassword } from "./crypto-utils.js";

const defaultDbPath = resolve(process.cwd(), ".data/xllmapi.db");
const dbPath = process.env.XLLMAPI_DB_PATH ?? defaultDbPath;

mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
const DEEPSEEK_API_KEY = process.env.XLLMAPI_DEEPSEEK_API_KEY ?? null;

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS user_identities (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS login_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_email_challenges (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT,
    token_hash TEXT,
    user_id TEXT,
    target_email TEXT,
    invitation_id TEXT,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    invalidated_at TEXT,
    send_count INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT,
    verify_attempt_count INTEGER NOT NULL DEFAULT 0,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_passwords (
    user_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    inviter_user_id TEXT NOT NULL,
    invited_email TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    accepted_user_id TEXT,
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT PRIMARY KEY,
    available_token_credit INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT NOT NULL,
    hashed_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_credentials (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    base_url TEXT,
    encrypted_secret TEXT,
    api_key_fingerprint TEXT,
    api_key_env_name TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS offerings (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    logical_model TEXT NOT NULL,
    credential_id TEXT NOT NULL,
    real_model TEXT NOT NULL,
    pricing_mode TEXT NOT NULL,
    fixed_price_per_1k_input INTEGER NOT NULL,
    fixed_price_per_1k_output INTEGER NOT NULL,
    enabled INTEGER NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'approved'
  );

  CREATE TABLE IF NOT EXISTS api_requests (
    id TEXT PRIMARY KEY,
    requester_user_id TEXT NOT NULL,
    logical_model TEXT NOT NULL,
    chosen_offering_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    real_model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT,
    response_body TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount INTEGER NOT NULL,
    entry_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settlement_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    consumer_user_id TEXT NOT NULL,
    supplier_user_id TEXT NOT NULL,
    consumer_cost INTEGER NOT NULL,
    supplier_reward INTEGER NOT NULL,
    platform_margin INTEGER NOT NULL,
    supplier_reward_rate REAL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settlement_failures (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    requester_user_id TEXT NOT NULL,
    supplier_user_id TEXT NOT NULL,
    logical_model TEXT NOT NULL,
    offering_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    real_model TEXT NOT NULL,
    error_message TEXT NOT NULL,
    settlement_payload TEXT NOT NULL,
    failure_count INTEGER NOT NULL DEFAULT 1,
    first_failed_at TEXT NOT NULL,
    last_failed_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_delivery_attempts (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    template_key TEXT NOT NULL,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    challenge_id TEXT,
    status TEXT NOT NULL,
    provider_message_id TEXT,
    error_code TEXT,
    error_message TEXT,
    payload TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_change_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    old_email TEXT NOT NULL,
    new_email TEXT NOT NULL,
    challenge_id TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_ip TEXT,
    requested_user_agent TEXT,
    expires_at TEXT NOT NULL,
    verified_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    payload TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    logical_model TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    request_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT,
    updated_by TEXT
  );

  INSERT OR IGNORE INTO platform_config (key, value) VALUES
    ('supplier_reward_rate', '0.85'),
    ('initial_token_credit', '1000000'),
    ('chat_rate_limit_per_minute', '60'),
    ('default_invitation_quota', '5'),
    ('min_input_price_per_1k', '100'),
    ('min_output_price_per_1k', '200'),
    ('max_input_price_per_1k', '10000'),
    ('max_output_price_per_1k', '20000');
`);

const ensure_column_ = (tableName: string, columnName: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
};

const normalize_base_url_ = (baseUrl?: string | null) => {
  const normalized = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
};

const provider_key_fingerprint_ = (params: {
  providerType: CandidateOffering["providerType"];
  baseUrl?: string | null;
  apiKey: string;
}) =>
  hashApiKey(
    `${params.providerType}|${(normalize_base_url_(params.baseUrl) ?? "").toLowerCase()}|${params.apiKey.trim()}`
  );

ensure_column_("provider_credentials", "encrypted_secret", "TEXT");
ensure_column_("provider_credentials", "api_key_fingerprint", "TEXT");
ensure_column_("users", "role", "TEXT NOT NULL DEFAULT 'user'");
ensure_column_("users", "handle", "TEXT");
ensure_column_("users", "status", "TEXT NOT NULL DEFAULT 'active'");
ensure_column_("users", "created_at", "TEXT");
ensure_column_("users", "last_login_at", "TEXT");
ensure_column_("users", "avatar_url", "TEXT");
ensure_column_("users", "phone", "TEXT");
ensure_column_("platform_api_keys", "created_at", "TEXT");
ensure_column_("provider_credentials", "created_at", "TEXT");
ensure_column_("offerings", "review_status", "TEXT NOT NULL DEFAULT 'approved'");
ensure_column_("offerings", "created_at", "TEXT");
ensure_column_("api_requests", "idempotency_key", "TEXT");
ensure_column_("api_requests", "response_body", "TEXT");

db.prepare("UPDATE users SET role = 'user' WHERE role IS NULL OR role = ''").run();
db.prepare("UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''").run();
db.prepare("UPDATE users SET handle = LOWER(REPLACE(id, '_', '-')) WHERE handle IS NULL OR handle = ''").run();
db.prepare("UPDATE users SET created_at = datetime('now') WHERE created_at IS NULL OR created_at = ''").run();
db.prepare("UPDATE users SET avatar_url = ? WHERE avatar_url IS NULL OR avatar_url = ''").run(DEFAULT_AVATAR_URL);
db.prepare("UPDATE platform_api_keys SET created_at = datetime('now') WHERE created_at IS NULL OR created_at = ''").run();
db.prepare("UPDATE provider_credentials SET created_at = datetime('now') WHERE created_at IS NULL OR created_at = ''").run();
db.prepare("UPDATE offerings SET review_status = 'approved' WHERE review_status IS NULL OR review_status = ''").run();
db.prepare("UPDATE offerings SET created_at = datetime('now') WHERE created_at IS NULL OR created_at = ''").run();
db.prepare("UPDATE offerings SET logical_model = REPLACE(logical_model, 'xllm/', '') WHERE logical_model LIKE 'xllm/%'").run();
db.prepare("UPDATE api_requests SET logical_model = REPLACE(logical_model, 'xllm/', '') WHERE logical_model LIKE 'xllm/%'").run();

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_credentials_owner_key
  ON provider_credentials (owner_user_id, provider_type, IFNULL(base_url, ''), api_key_fingerprint)
  WHERE api_key_fingerprint IS NOT NULL AND api_key_fingerprint != ''
`);

const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };

if (userCount.count === 0) {
  db.exec(`
    INSERT INTO users (id, display_name, role, handle, status, created_at) VALUES
      ('user_demo', 'Demo Consumer', 'user', 'demo-consumer', 'active', datetime('now')),
      ('admin_demo', 'Demo Admin', 'admin', 'admin-demo', 'active', datetime('now')),
      ('supplier_openai_demo', 'OpenAI Supplier', 'user', 'openai-supplier', 'active', datetime('now')),
      ('supplier_anthropic_demo', 'Anthropic Supplier', 'user', 'anthropic-supplier', 'active', datetime('now'));

    INSERT INTO wallets (user_id, available_token_credit) VALUES
      ('user_demo', ${DEFAULT_INITIAL_TOKEN_CREDIT}),
      ('admin_demo', ${DEFAULT_INITIAL_TOKEN_CREDIT}),
      ('supplier_openai_demo', ${DEFAULT_INITIAL_TOKEN_CREDIT}),
      ('supplier_anthropic_demo', ${DEFAULT_INITIAL_TOKEN_CREDIT});

    INSERT INTO platform_api_keys (id, user_id, label, hashed_key, status) VALUES
      ('pak_demo_user', 'user_demo', 'Local Demo Key', '${hashApiKey(DEV_USER_API_KEY)}', 'active'),
      ('pak_demo_admin', 'admin_demo', 'Local Admin Key', '${hashApiKey(DEV_ADMIN_API_KEY)}', 'active');

    INSERT INTO provider_credentials (id, owner_user_id, provider_type, base_url, encrypted_secret, api_key_env_name, status) VALUES
      ('cred_openai_demo', 'supplier_openai_demo', 'openai', 'https://api.openai.com/v1', NULL, 'OPENAI_API_KEY', 'active'),
      ('cred_anthropic_demo', 'supplier_anthropic_demo', 'anthropic', 'https://api.anthropic.com/v1', NULL, 'ANTHROPIC_API_KEY', 'active');

    INSERT INTO offerings (
      id, owner_user_id, logical_model, credential_id, real_model, pricing_mode,
      fixed_price_per_1k_input, fixed_price_per_1k_output, enabled, review_status
    ) VALUES
      ('offering_openai_demo', 'supplier_openai_demo', 'gpt-4o-mini', 'cred_openai_demo', 'gpt-4o-mini', 'fixed_price', 1000, 2000, 1, 'approved'),
      ('offering_anthropic_demo', 'supplier_anthropic_demo', 'claude-sonnet-4-20250514', 'cred_anthropic_demo', 'claude-sonnet-4-20250514', 'fixed_price', 1500, 3000, 1, 'approved');

    INSERT INTO user_identities (user_id, email, email_verified, created_at) VALUES
      ('user_demo', 'user_demo@xllmapi.local', 1, datetime('now')),
      ('admin_demo', 'admin_demo@xllmapi.local', 1, datetime('now')),
      ('supplier_openai_demo', 'supplier_openai_demo@xllmapi.local', 1, datetime('now')),
      ('supplier_anthropic_demo', 'supplier_anthropic_demo@xllmapi.local', 1, datetime('now'));
  `);
}

db.prepare(`
  INSERT INTO platform_api_keys (id, user_id, label, hashed_key, status)
  VALUES (?, ?, ?, ?, 'active')
  ON CONFLICT(id) DO NOTHING
`).run(
  "pak_demo_user",
  "user_demo",
  "Local Demo Key",
  hashApiKey(DEV_USER_API_KEY)
);

db.prepare(`
  INSERT INTO users (id, display_name, role, handle, status, created_at)
  VALUES ('admin_demo', 'Demo Admin', 'admin', 'admin-demo', 'active', datetime('now'))
  ON CONFLICT(id) DO UPDATE SET role = excluded.role, handle = excluded.handle, status = excluded.status
`).run();

db.prepare(`
  INSERT INTO user_identities (user_id, email, email_verified, created_at)
  VALUES ('user_demo', 'user_demo@xllmapi.local', 1, datetime('now'))
  ON CONFLICT(user_id) DO NOTHING
`).run();

db.prepare(`
  INSERT INTO user_identities (user_id, email, email_verified, created_at)
  VALUES ('admin_demo', 'admin_demo@xllmapi.local', 1, datetime('now'))
  ON CONFLICT(user_id) DO NOTHING
`).run();

db.prepare(`
  INSERT INTO users (id, display_name, role, handle, status, created_at)
  VALUES ('supplier_openai_demo', 'OpenAI Supplier', 'user', 'openai-supplier', 'active', datetime('now'))
  ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, status = excluded.status
`).run();

db.prepare(`
  INSERT INTO users (id, display_name, role, handle, status, created_at)
  VALUES ('supplier_anthropic_demo', 'Anthropic Supplier', 'user', 'anthropic-supplier', 'active', datetime('now'))
  ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, status = excluded.status
`).run();

db.prepare(`
  INSERT INTO user_identities (user_id, email, email_verified, created_at)
  VALUES ('supplier_openai_demo', 'supplier_openai_demo@xllmapi.local', 1, datetime('now'))
  ON CONFLICT(user_id) DO NOTHING
`).run();

db.prepare(`
  INSERT INTO user_identities (user_id, email, email_verified, created_at)
  VALUES ('supplier_anthropic_demo', 'supplier_anthropic_demo@xllmapi.local', 1, datetime('now'))
  ON CONFLICT(user_id) DO NOTHING
`).run();

db.prepare(`
  INSERT INTO wallets (user_id, available_token_credit)
  VALUES ('admin_demo', ?)
  ON CONFLICT(user_id) DO UPDATE SET available_token_credit = excluded.available_token_credit
`).run(DEFAULT_INITIAL_TOKEN_CREDIT);

db.prepare(`
  INSERT INTO wallets (user_id, available_token_credit)
  VALUES ('user_demo', ?)
  ON CONFLICT(user_id) DO UPDATE SET available_token_credit = excluded.available_token_credit
`).run(DEFAULT_INITIAL_TOKEN_CREDIT);

db.prepare(`
  INSERT INTO wallets (user_id, available_token_credit)
  VALUES ('supplier_openai_demo', ?)
  ON CONFLICT(user_id) DO UPDATE SET available_token_credit = excluded.available_token_credit
`).run(DEFAULT_INITIAL_TOKEN_CREDIT);

db.prepare(`
  INSERT INTO wallets (user_id, available_token_credit)
  VALUES ('supplier_anthropic_demo', ?)
  ON CONFLICT(user_id) DO UPDATE SET available_token_credit = excluded.available_token_credit
`).run(DEFAULT_INITIAL_TOKEN_CREDIT);

db.prepare(`
  INSERT INTO platform_api_keys (id, user_id, label, hashed_key, status)
  VALUES (?, ?, ?, ?, 'active')
  ON CONFLICT(id) DO NOTHING
`).run(
  "pak_demo_admin",
  "admin_demo",
  "Local Admin Key",
  hashApiKey(DEV_ADMIN_API_KEY)
);

db.prepare(`
  INSERT INTO user_passwords (user_id, password_hash, updated_at)
  VALUES
    ('admin_demo', ?, datetime('now')),
    ('user_demo', ?, datetime('now'))
  ON CONFLICT(user_id) DO NOTHING
`).run(
  hashPassword("admin123456"),
  hashPassword("user123456")
);

if (DEEPSEEK_API_KEY) {
  db.prepare(`
    INSERT INTO users (id, display_name, role, handle, status, created_at)
    VALUES ('supplier_deepseek_demo', 'DeepSeek Supplier', 'user', 'deepseek-supplier', 'active', datetime('now'))
    ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, status = excluded.status
  `).run();

  db.prepare(`
    INSERT INTO user_identities (user_id, email, email_verified, created_at)
    VALUES ('supplier_deepseek_demo', 'supplier_deepseek_demo@xllmapi.local', 1, datetime('now'))
    ON CONFLICT(user_id) DO NOTHING
  `).run();

  db.prepare(`
    INSERT INTO wallets (user_id, available_token_credit)
    VALUES ('supplier_deepseek_demo', ?)
    ON CONFLICT(user_id) DO UPDATE SET available_token_credit = excluded.available_token_credit
  `).run(DEFAULT_INITIAL_TOKEN_CREDIT);

  db.prepare(`
    INSERT INTO provider_credentials (
      id, owner_user_id, provider_type, base_url, encrypted_secret, api_key_env_name, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'active')
    ON CONFLICT(id) DO UPDATE SET
      provider_type = excluded.provider_type,
      base_url = excluded.base_url,
      encrypted_secret = excluded.encrypted_secret,
      api_key_env_name = excluded.api_key_env_name,
      status = excluded.status
  `).run(
    "cred_deepseek_demo",
    "supplier_deepseek_demo",
    "openai_compatible",
    "https://api.deepseek.com",
    encryptSecret(DEEPSEEK_API_KEY),
    "",
  );

  db.prepare(`
    INSERT INTO offerings (
      id, owner_user_id, logical_model, credential_id, real_model, pricing_mode,
      fixed_price_per_1k_input, fixed_price_per_1k_output, enabled, review_status
    ) VALUES (?, ?, ?, ?, ?, 'fixed_price', ?, ?, 1, 'approved')
    ON CONFLICT(id) DO UPDATE SET
      owner_user_id = excluded.owner_user_id,
      logical_model = excluded.logical_model,
      credential_id = excluded.credential_id,
      real_model = excluded.real_model,
      pricing_mode = excluded.pricing_mode,
      fixed_price_per_1k_input = excluded.fixed_price_per_1k_input,
      fixed_price_per_1k_output = excluded.fixed_price_per_1k_output,
      enabled = excluded.enabled,
      review_status = excluded.review_status
  `).run(
    "offering_deepseek_demo",
    "supplier_deepseek_demo",
    "deepseek-chat",
    "cred_deepseek_demo",
    "deepseek-chat",
    300,
    500
  );
}

type OfferingRow = CandidateOffering & {
  logicalModel: string;
  apiKeyEnvName: string;
  reviewStatus: "pending" | "approved" | "rejected";
};

type OfferingDbRow = Omit<OfferingRow, "enabled"> & {
  enabled: number;
};

type ProviderCredentialRow = {
  id: string;
  ownerUserId: string;
  providerType: CandidateOffering["providerType"];
  baseUrl: string | null;
  hasEncryptedSecret: boolean;
  apiKeyEnvName: string;
  status: string;
};

type ProviderCredentialDbRow = Omit<ProviderCredentialRow, "hasEncryptedSecret"> & {
  hasEncryptedSecret: number;
};

type LogicalModelRow = PublicMarketModel;

type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

type IdentityRow = {
  userId: string;
  email: string;
  emailVerified: number;
  createdAt: string;
  lastLoginAt: string | null;
};

type InvitationRow = {
  id: string;
  inviterUserId: string;
  invitedEmail: string;
  status: string;
  note: string | null;
  acceptedUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type VerifyLoginCodeResult =
  | {
      ok: true;
      token: string;
      user: MeProfile;
      firstLoginCompleted: boolean;
      initialApiKey: string | null;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

const now_iso_ = () => new Date().toISOString();

const generate_code_ = () => String(randomInt(100000, 1000000));

const normalize_email_ = (value: string) => value.trim().toLowerCase();

const ensure_user_api_key_ = (userId: string, label = "Default API Key") => {
  const existing = db.prepare(`
    SELECT id
    FROM platform_api_keys
    WHERE user_id = ? AND status = 'active'
    ORDER BY id ASC
    LIMIT 1
  `).get(userId) as { id: string } | undefined;

  if (existing) {
    return null;
  }

  const rawKey = `xllm_${randomUUID().replaceAll("-", "")}`;
  db.prepare(`
    INSERT INTO platform_api_keys (id, user_id, label, hashed_key, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(`pak_${randomUUID()}`, userId, label, hashApiKey(rawKey));
  return rawKey;
};

const get_identity_by_email_ = (email: string) =>
  db.prepare(`
    SELECT
      user_id AS userId,
      email,
      email_verified AS emailVerified,
      created_at AS createdAt,
      last_login_at AS lastLoginAt
    FROM user_identities
    WHERE email = ?
    LIMIT 1
  `).get(normalize_email_(email)) as IdentityRow | undefined;

const get_invitation_by_email_ = (email: string) =>
  db.prepare(`
    SELECT *
    FROM invitations
    WHERE invited_email = ?
      AND status = 'pending'
      AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(normalize_email_(email), now_iso_()) as InvitationRow | undefined;

const get_auth_email_challenge_by_code_ = (email: string, purpose: string, code: string) =>
  db.prepare(`
    SELECT id
    FROM auth_email_challenges
    WHERE email = ?
      AND purpose = ?
      AND code_hash = ?
      AND consumed_at IS NULL
      AND invalidated_at IS NULL
      AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(normalize_email_(email), purpose, hashApiKey(code), now_iso_()) as { id: string } | undefined;

const get_auth_email_challenge_by_token_ = (token: string, purpose: string) =>
  db.prepare(`
    SELECT
      id,
      user_id AS userId,
      email,
      target_email AS targetEmail,
      metadata
    FROM auth_email_challenges
    WHERE purpose = ?
      AND token_hash = ?
      AND consumed_at IS NULL
      AND invalidated_at IS NULL
      AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(purpose, hashApiKey(token), now_iso_()) as {
    id: string;
    userId: string | null;
    email: string;
    targetEmail: string | null;
    metadata: string | null;
  } | undefined;

const invalidate_auth_email_challenges_ = (params: {
  email: string;
  purpose: string;
  userId?: string | null;
}) => {
  db.prepare(`
    UPDATE auth_email_challenges
    SET invalidated_at = ?
    WHERE email = ?
      AND purpose = ?
      AND consumed_at IS NULL
      AND invalidated_at IS NULL
      ${params.userId ? "AND COALESCE(user_id, '') = ?" : ""}
  `).run(...[
    now_iso_(),
    normalize_email_(params.email),
    params.purpose,
    ...(params.userId ? [params.userId] : [])
  ]);
};

const create_auth_email_challenge_ = (params: {
  email: string;
  purpose: string;
  ttlSeconds: number;
  code?: string | null;
  token?: string | null;
  userId?: string | null;
  targetEmail?: string | null;
  invitationId?: string | null;
  metadata?: unknown;
}) => {
  const id = `emlch_${randomUUID()}`;
  const now = now_iso_();
  db.prepare(`
    INSERT INTO auth_email_challenges (
      id, email, purpose, code_hash, token_hash, user_id, target_email, invitation_id,
      expires_at, consumed_at, invalidated_at, send_count, last_sent_at, verify_attempt_count, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?, 0, ?, ?)
  `).run(
    id,
    normalize_email_(params.email),
    params.purpose,
    params.code ? hashApiKey(params.code) : null,
    params.token ? hashApiKey(params.token) : null,
    params.userId ?? null,
    params.targetEmail ? normalize_email_(params.targetEmail) : null,
    params.invitationId ?? null,
    new Date(Date.now() + params.ttlSeconds * 1000).toISOString(),
    now,
    params.metadata ? JSON.stringify(params.metadata) : null,
    now
  );

  return id;
};

const revoke_user_sessions_ = (params: { userId: string; exceptSessionId?: string | null }) => {
  const result = params.exceptSessionId
    ? db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND id != ?").run(params.userId, params.exceptSessionId)
    : db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(params.userId);
  return Number(result.changes);
};

const get_me_profile_ = (userId: string): MeProfile | null => {
  const row = db.prepare(`
    SELECT
      u.id,
      i.email,
      u.display_name AS displayName,
      u.handle,
      u.role,
      u.avatar_url AS avatarUrl,
      u.phone,
      CASE WHEN p.user_id IS NULL THEN 0 ELSE 1 END AS hasPassword
    FROM users u
    JOIN user_identities i ON i.user_id = u.id
    LEFT JOIN user_passwords p ON p.user_id = u.id
    WHERE u.id = ?
    LIMIT 1
  `).get(userId) as {
    id: string;
    email: string;
    displayName: string;
    handle: string;
    role: "user" | "admin";
    avatarUrl: string | null;
    phone: string | null;
    hasPassword: number;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    ...row,
    inviteStatus: "active",
    avatarUrl: row.avatarUrl ?? DEFAULT_AVATAR_URL,
    phone: row.phone ?? null,
    hasPassword: row.hasPassword === 1
  };
};

export const find_user_by_api_key = (
  rawApiKey: string
): { userId: string; apiKeyId: string; label: string; role: string } | null => {
  const row = db
    .prepare(`
      SELECT
        k.id AS apiKeyId,
        k.user_id AS userId,
        k.label,
        u.role
      FROM platform_api_keys k
      JOIN users u ON u.id = k.user_id
      WHERE hashed_key = ? AND status = 'active'
      LIMIT 1
    `)
    .get(hashApiKey(rawApiKey)) as
    | {
        apiKeyId: string;
        userId: string;
        label: string;
        role: string;
      }
    | undefined;

  return row ?? null;
};

export const find_user_by_session_token = (
  rawSessionToken: string
): {
  userId: string;
  role: "user" | "admin";
  email: string;
  displayName: string;
  handle: string;
  sessionId: string;
} | null => {
  const row = db.prepare(`
    SELECT
      s.id AS sessionId,
      u.id AS userId,
      u.role,
      u.display_name AS displayName,
      u.handle,
      i.email
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN user_identities i ON i.user_id = u.id
    WHERE s.token_hash = ?
      AND s.expires_at > ?
    LIMIT 1
  `).get(hashApiKey(rawSessionToken), now_iso_()) as {
    sessionId: string;
    userId: string;
    role: "user" | "admin";
    email: string;
    displayName: string;
    handle: string;
  } | undefined;

  return row ?? null;
};

export const revoke_session = (sessionId: string) => {
  const result = db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(sessionId);
  return result.changes > 0;
};

export const request_login_code = (email: string) => {
  const normalizedEmail = normalize_email_(email);
  const identity = get_identity_by_email_(normalizedEmail);
  const invitation = get_invitation_by_email_(normalizedEmail);

  if (!identity && !invitation) {
    return {
      eligible: false,
      firstLogin: false,
      email: normalizedEmail
    };
  }

  const code = generate_code_();
  invalidate_auth_email_challenges_({
    email: normalizedEmail,
    purpose: identity ? "login_code" : "invite_signup_code",
    userId: identity?.userId ?? null
  });
  const challengeId = create_auth_email_challenge_({
    email: normalizedEmail,
    purpose: identity ? "login_code" : "invite_signup_code",
    ttlSeconds: config.authCodeTtlSeconds,
    code,
    userId: identity?.userId ?? null,
    invitationId: invitation?.id ?? null
  });

  return {
    eligible: true,
    firstLogin: !identity,
    challengeId,
    email: normalizedEmail,
    code: config.isProduction ? undefined : code
  };
};

export const verify_login_code = (email: string, code: string): VerifyLoginCodeResult => {
  const normalizedEmail = normalize_email_(email);
  const now = now_iso_();
  const identity = get_identity_by_email_(normalizedEmail);
  const codeRow = get_auth_email_challenge_by_code_(
    normalizedEmail,
    identity ? "login_code" : "invite_signup_code",
    code
  );
  const legacyCodeRow = !codeRow
    ? db.prepare(`
      SELECT id
      FROM login_codes
      WHERE email = ?
        AND code_hash = ?
        AND consumed_at IS NULL
        AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(normalizedEmail, hashApiKey(code), now) as { id: string } | undefined
    : undefined;

  if (!codeRow && !legacyCodeRow) {
    return { ok: false as const, code: "invalid_code", message: "invalid or expired verification code" };
  }

  let me = get_me_profile_(identity?.userId ?? "");
  let firstLoginCompleted = false;
  let initialApiKey: string | null = null;

  db.exec("BEGIN");
  try {
    if (codeRow) {
      db.prepare("UPDATE auth_email_challenges SET consumed_at = ? WHERE id = ?").run(now, codeRow.id);
    } else if (legacyCodeRow) {
      db.prepare("UPDATE login_codes SET consumed_at = ? WHERE id = ?").run(now, legacyCodeRow.id);
    }

    if (!me) {
      const invitation = get_invitation_by_email_(normalizedEmail);
      if (!invitation) {
        db.exec("ROLLBACK");
        return { ok: false as const, code: "invite_required", message: "email has not been invited" };
      }

      const newUserId = `user_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const defaultHandle = `u-${newUserId.slice(-8)}`;
      db.prepare(`
        INSERT INTO users (id, display_name, role, handle, status, created_at, last_login_at)
        VALUES (?, ?, 'user', ?, 'active', ?, ?)
      `).run(newUserId, normalizedEmail.split("@")[0], defaultHandle, now, now);
      db.prepare(`
        INSERT INTO user_identities (user_id, email, email_verified, created_at, last_login_at)
        VALUES (?, ?, 1, ?, ?)
      `).run(newUserId, normalizedEmail, now, now);
      const creditRow = db.prepare("SELECT value FROM platform_config WHERE key = 'initial_token_credit'").get() as { value: string } | undefined;
      const initialCredit = creditRow?.value ? Number(creditRow.value) : DEFAULT_INITIAL_TOKEN_CREDIT;
      db.prepare(`
        INSERT INTO wallets (user_id, available_token_credit)
        VALUES (?, ?)
      `).run(newUserId, initialCredit);
      db.prepare(`
        UPDATE invitations
        SET status = 'accepted',
            accepted_user_id = ?,
            accepted_at = ?
        WHERE id = ?
      `).run(newUserId, now, invitation.id);
      initialApiKey = ensure_user_api_key_(newUserId, "Initial API Key");
      me = get_me_profile_(newUserId);
      firstLoginCompleted = true;
    } else {
      db.prepare("UPDATE user_identities SET last_login_at = ? WHERE user_id = ?").run(now, me.id);
      db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, me.id);
      initialApiKey = ensure_user_api_key_(me.id, "Initial API Key");
    }

    const sessionToken = `sess_${randomUUID().replaceAll("-", "")}`;
    if (!me) {
      throw new Error("me profile must exist after login verification");
    }

    db.prepare(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `sessrow_${randomUUID()}`,
      me.id,
      hashApiKey(sessionToken),
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      now
    );

    db.exec("COMMIT");

    return {
      ok: true as const,
      token: sessionToken,
      user: me,
      firstLoginCompleted,
      initialApiKey
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const login_with_password = (email: string, password: string): VerifyLoginCodeResult => {
  const normalizedEmail = normalize_email_(email);
  const identity = get_identity_by_email_(normalizedEmail);
  if (!identity) {
    return { ok: false, code: "invalid_credentials", message: "invalid email or password" };
  }

  const passwordRow = db.prepare(`
    SELECT password_hash AS passwordHash
    FROM user_passwords
    WHERE user_id = ?
    LIMIT 1
  `).get(identity.userId) as { passwordHash: string } | undefined;

  if (!passwordRow || !verifyPassword(password, passwordRow.passwordHash)) {
    return { ok: false, code: "invalid_credentials", message: "invalid email or password" };
  }

  const me = get_me_profile_(identity.userId);
  if (!me) {
    return { ok: false, code: "invalid_credentials", message: "invalid email or password" };
  }

  const now = now_iso_();
  const sessionToken = `sess_${randomUUID().replaceAll("-", "")}`;
  db.prepare("UPDATE user_identities SET last_login_at = ? WHERE user_id = ?").run(now, me.id);
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, me.id);
  if (passwordNeedsRehash(passwordRow.passwordHash)) {
    db.prepare(`
      UPDATE user_passwords
      SET password_hash = ?, updated_at = ?
      WHERE user_id = ?
    `).run(hashPassword(password), now, me.id);
  }
  db.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    `sessrow_${randomUUID()}`,
    me.id,
    hashApiKey(sessionToken),
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    now
  );

  return {
    ok: true,
    token: sessionToken,
    user: me,
    firstLoginCompleted: false,
    initialApiKey: ensure_user_api_key_(me.id, "Initial API Key")
  };
};

export const update_me_profile = (params: {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
}) => {
  const current = get_me_profile_(params.userId);
  if (!current) {
    return null;
  }
  db.prepare(`
    UPDATE users
    SET display_name = ?, avatar_url = ?
    WHERE id = ?
  `).run(
    params.displayName?.trim() || current.displayName,
    params.avatarUrl?.trim() || current.avatarUrl || DEFAULT_AVATAR_URL,
    params.userId
  );
  return get_me_profile_(params.userId);
};

export const update_me_password = (params: {
  userId: string;
  currentSessionId?: string | null;
  currentPassword: string;
  newPassword: string;
}) => {
  const current = db.prepare(`
    SELECT password_hash AS passwordHash
    FROM user_passwords
    WHERE user_id = ?
    LIMIT 1
  `).get(params.userId) as { passwordHash: string } | undefined;

  if (current && !verifyPassword(params.currentPassword, current.passwordHash)) {
    return { ok: false as const, code: "invalid_password", message: "current password is invalid" };
  }

  if (!current && params.currentPassword.trim().length > 0) {
    return { ok: false as const, code: "invalid_password", message: "current password is invalid" };
  }

  db.prepare(`
    INSERT INTO user_passwords (user_id, password_hash, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      password_hash = excluded.password_hash,
      updated_at = excluded.updated_at
  `).run(params.userId, hashPassword(params.newPassword), now_iso_());

  const sessionsRevoked = revoke_user_sessions_({
    userId: params.userId,
    exceptSessionId: params.currentSessionId ?? null
  });

  return { ok: true as const, data: { sessionsRevoked } };
};

export const update_me_email = (params: { userId: string; newEmail: string }) => {
  const normalizedEmail = normalize_email_(params.newEmail);
  const existing = get_identity_by_email_(normalizedEmail);
  if (existing && existing.userId !== params.userId) {
    return { ok: false as const, code: "email_taken", message: "email already in use" };
  }

  db.prepare(`
    UPDATE user_identities
    SET email = ?, email_verified = 1
    WHERE user_id = ?
  `).run(normalizedEmail, params.userId);
  return { ok: true as const, data: get_me_profile_(params.userId) };
};

export const update_me_phone = (params: { userId: string; phone: string }) => {
  db.prepare(`
    UPDATE users
    SET phone = ?
    WHERE id = ?
  `).run(params.phone.trim(), params.userId);
  return { ok: true as const, data: get_me_profile_(params.userId) };
};

export const request_password_reset = (email: string) => {
  const normalizedEmail = normalize_email_(email);
  const identity = get_identity_by_email_(normalizedEmail);
  if (!identity) {
    return {
      accepted: false,
      email: normalizedEmail,
      challengeId: null,
      userId: null
    };
  }

  const token = `reset_${randomUUID().replaceAll("-", "")}`;
  invalidate_auth_email_challenges_({
    email: normalizedEmail,
    purpose: "password_reset",
    userId: identity.userId
  });
  const challengeId = create_auth_email_challenge_({
    email: normalizedEmail,
    purpose: "password_reset",
    ttlSeconds: config.passwordResetTtlSeconds,
    token,
    userId: identity.userId
  });

  return {
    accepted: true,
    email: normalizedEmail,
    token,
    challengeId,
    userId: identity.userId
  };
};

export const reset_password = (params: { token: string; newPassword: string }) => {
  const challenge = get_auth_email_challenge_by_token_(params.token, "password_reset");
  if (!challenge?.userId) {
    return { ok: false as const, code: "invalid_token", message: "invalid or expired reset token" };
  }

  const now = now_iso_();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE auth_email_challenges SET consumed_at = ? WHERE id = ?").run(now, challenge.id);
    db.prepare(`
      INSERT INTO user_passwords (user_id, password_hash, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        password_hash = excluded.password_hash,
        updated_at = excluded.updated_at
    `).run(challenge.userId, hashPassword(params.newPassword), now);
    db.prepare(`
      UPDATE auth_email_challenges
      SET invalidated_at = ?
      WHERE purpose = 'password_reset'
        AND user_id = ?
        AND consumed_at IS NULL
        AND invalidated_at IS NULL
    `).run(now, challenge.userId);
    const sessionsRevoked = revoke_user_sessions_({ userId: challenge.userId });
    db.exec("COMMIT");
    return { ok: true as const, data: { userId: challenge.userId, sessionsRevoked } };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const request_email_change = (params: {
  userId: string;
  newEmail: string;
  currentPassword?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) => {
  const me = get_me_profile_(params.userId);
  if (!me) {
    return { ok: false as const, code: "not_found", message: "user not found" };
  }

  const normalizedEmail = normalize_email_(params.newEmail);
  const existing = get_identity_by_email_(normalizedEmail);
  if (existing && existing.userId !== params.userId) {
    return { ok: false as const, code: "email_taken", message: "email already in use" };
  }
  if (normalizedEmail === normalize_email_(me.email)) {
    return { ok: false as const, code: "email_unchanged", message: "new email must be different" };
  }

  const current = db.prepare(`
    SELECT password_hash AS passwordHash
    FROM user_passwords
    WHERE user_id = ?
    LIMIT 1
  `).get(params.userId) as { passwordHash: string } | undefined;

  if (current && !verifyPassword(params.currentPassword ?? "", current.passwordHash)) {
    return { ok: false as const, code: "invalid_password", message: "current password is invalid" };
  }

  const token = `emailchg_${randomUUID().replaceAll("-", "")}`;
  invalidate_auth_email_challenges_({
    email: normalizedEmail,
    purpose: "email_change_verify_new",
    userId: params.userId
  });
  const challengeId = create_auth_email_challenge_({
    email: normalizedEmail,
    purpose: "email_change_verify_new",
    ttlSeconds: config.emailChangeTtlSeconds,
    token,
    userId: params.userId,
    targetEmail: normalizedEmail,
    metadata: {
      oldEmail: me.email,
      newEmail: normalizedEmail
    }
  });
  const requestId = `emailreq_${randomUUID()}`;
  db.prepare(`
    INSERT INTO email_change_requests (
      id, user_id, old_email, new_email, challenge_id, status, requested_ip, requested_user_agent,
      expires_at, verified_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, ?)
  `).run(
    requestId,
    params.userId,
    normalize_email_(me.email),
    normalizedEmail,
    challengeId,
    params.ipAddress ?? null,
    params.userAgent ?? null,
    new Date(Date.now() + config.emailChangeTtlSeconds * 1000).toISOString(),
    now_iso_()
  );

  return {
    ok: true as const,
    data: {
      requestId,
      oldEmail: normalize_email_(me.email),
      newEmail: normalizedEmail,
      token,
      challengeId
    }
  };
};

export const confirm_email_change = (params: { token: string; sessionId?: string | null }) => {
  const challenge = get_auth_email_challenge_by_token_(params.token, "email_change_verify_new");
  if (!challenge?.userId || !challenge.targetEmail) {
    return { ok: false as const, code: "invalid_token", message: "invalid or expired email change token" };
  }

  const request = db.prepare(`
    SELECT id, old_email AS oldEmail, new_email AS newEmail
    FROM email_change_requests
    WHERE challenge_id = ?
      AND status = 'pending'
      AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(challenge.id, now_iso_()) as { id: string; oldEmail: string; newEmail: string } | undefined;

  if (!request) {
    return { ok: false as const, code: "invalid_token", message: "invalid or expired email change token" };
  }

  const existing = get_identity_by_email_(challenge.targetEmail);
  if (existing && existing.userId !== challenge.userId) {
    return { ok: false as const, code: "email_taken", message: "email already in use" };
  }

  const now = now_iso_();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE auth_email_challenges SET consumed_at = ? WHERE id = ?").run(now, challenge.id);
    db.prepare(`
      UPDATE email_change_requests
      SET status = 'verified', verified_at = ?
      WHERE id = ?
    `).run(now, request.id);
    db.prepare(`
      UPDATE user_identities
      SET email = ?, email_verified = 1
      WHERE user_id = ?
    `).run(challenge.targetEmail, challenge.userId);
    revoke_user_sessions_({
      userId: challenge.userId,
      exceptSessionId: params.sessionId ?? null
    });
    db.exec("COMMIT");
    return {
      ok: true as const,
      data: {
        profile: get_me_profile_(challenge.userId),
        oldEmail: request.oldEmail,
        newEmail: request.newEmail
      }
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const get_me = (userId: string) => get_me_profile_(userId);

export const get_invitation_stats = (userId: string): InvitationStats => {
  const user = db.prepare("SELECT role FROM users WHERE id = ? LIMIT 1").get(userId) as { role: string } | undefined;
  const used = db.prepare(`
    SELECT COUNT(*) AS count
    FROM invitations
    WHERE inviter_user_id = ?
  `).get(userId) as { count: number };

  if (user?.role === "admin") {
    return {
      limit: null,
      used: used.count,
      remaining: null,
      unlimited: true,
      enabled: true
    };
  }

  return {
    limit: 10,
    used: used.count,
    remaining: Math.max(0, 10 - used.count),
    unlimited: false,
    enabled: true
  };
};

export const list_invitations = (userId: string) =>
  db.prepare(`
    SELECT
      id,
      inviter_user_id AS inviterUserId,
      invited_email AS invitedEmail,
      status,
      note,
      accepted_user_id AS acceptedUserId,
      expires_at AS expiresAt,
      accepted_at AS acceptedAt,
      revoked_at AS revokedAt,
      created_at AS createdAt
    FROM invitations
    WHERE inviter_user_id = ?
    ORDER BY created_at DESC
  `).all(userId);

export const create_invitation = (params: {
  inviterUserId: string;
  invitedEmail: string;
  note?: string;
}) => {
  const normalizedEmail = normalize_email_(params.invitedEmail);
  if (get_identity_by_email_(normalizedEmail)) {
    return { ok: false as const, code: "already_registered", message: "email is already registered" };
  }

  const existing = db.prepare(`
    SELECT id
    FROM invitations
    WHERE invited_email = ?
      AND status = 'pending'
      AND expires_at > ?
    LIMIT 1
  `).get(normalizedEmail, now_iso_()) as { id: string } | undefined;

  if (existing) {
    return { ok: false as const, code: "already_invited", message: "email already has a pending invitation" };
  }

  const stats = get_invitation_stats(params.inviterUserId);
  if (!stats.unlimited && (stats.remaining ?? 0) <= 0) {
    return { ok: false as const, code: "invite_limit_reached", message: "invitation limit reached" };
  }

  const id = `invite_${randomUUID()}`;
  db.prepare(`
    INSERT INTO invitations (
      id, inviter_user_id, invited_email, status, note, expires_at, created_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    id,
    params.inviterUserId,
    normalizedEmail,
    params.note ?? null,
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    now_iso_()
  );

  return { ok: true as const, data: db.prepare("SELECT * FROM invitations WHERE id = ? LIMIT 1").get(id) };
};

export const revoke_invitation = (params: {
  actorUserId: string;
  invitationId: string;
  isAdmin: boolean;
}) => {
  const invitation = db.prepare(`
    SELECT id, inviter_user_id AS inviterUserId, status
    FROM invitations
    WHERE id = ?
    LIMIT 1
  `).get(params.invitationId) as { id: string; inviterUserId: string; status: string } | undefined;

  if (!invitation) {
    return { ok: false as const, code: "not_found", message: "invitation not found" };
  }

  if (!params.isAdmin && invitation.inviterUserId !== params.actorUserId) {
    return { ok: false as const, code: "forbidden", message: "invitation does not belong to current user" };
  }

  if (invitation.status !== "pending") {
    return { ok: false as const, code: "invalid_state", message: "only pending invitations can be revoked" };
  }

  db.prepare(`
    UPDATE invitations
    SET status = 'revoked',
        revoked_at = ?
    WHERE id = ?
  `).run(now_iso_(), params.invitationId);

  return { ok: true as const };
};

export const list_admin_invitations = () =>
  db.prepare(`
    SELECT
      i.id,
      i.invited_email AS invitedEmail,
      i.status,
      i.note,
      i.expires_at AS expiresAt,
      i.accepted_at AS acceptedAt,
      i.created_at AS createdAt,
      u.display_name AS inviterDisplayName,
      u.handle AS inviterHandle
    FROM invitations i
    JOIN users u ON u.id = i.inviter_user_id
    ORDER BY i.created_at DESC
  `).all();

export const list_admin_users = () =>
  db.prepare(`
    SELECT
      u.id,
      u.display_name AS displayName,
      u.handle,
      u.role,
      u.status,
      i.email,
      u.created_at AS createdAt,
      u.last_login_at AS lastLoginAt,
      (SELECT se.ip_address FROM security_events se WHERE se.user_id = u.id ORDER BY se.created_at DESC LIMIT 1) AS lastLoginIp
    FROM users u
    LEFT JOIN user_identities i ON i.user_id = u.id
    ORDER BY u.created_at DESC
  `).all();

export const get_config_value = (key: string): string | null => {
  const row = db.prepare("SELECT value FROM platform_config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
};

export const get_wallet_balance = (userId: string): number => {
  const row = db
    .prepare("SELECT available_token_credit FROM wallets WHERE user_id = ?")
    .get(userId) as { available_token_credit: number } | undefined;

  return row?.available_token_credit ?? 0;
};

export const create_provider_credential = (params: {
  id: string;
  ownerUserId: string;
  providerType: CandidateOffering["providerType"];
  baseUrl?: string;
  apiKey: string;
}): MutationResult<ProviderCredentialRow> => {
  const normalizedBaseUrl = normalize_base_url_(params.baseUrl);
  const fingerprint = provider_key_fingerprint_({
    providerType: params.providerType,
    baseUrl: normalizedBaseUrl,
    apiKey: params.apiKey
  });
  const existing = db.prepare(`
    SELECT id
    FROM provider_credentials
    WHERE owner_user_id = ?
      AND provider_type = ?
      AND IFNULL(base_url, '') = IFNULL(?, '')
      AND api_key_fingerprint = ?
    LIMIT 1
  `).get(
    params.ownerUserId,
    params.providerType,
    normalizedBaseUrl,
    fingerprint
  ) as { id: string } | undefined;

  if (existing) {
    return {
      ok: false,
      code: "duplicate_provider_key",
      message: "this API key is already connected"
    };
  }

  db.prepare(`
    INSERT INTO provider_credentials (
      id, owner_user_id, provider_type, base_url, encrypted_secret, api_key_env_name, status, api_key_fingerprint, created_at
    ) VALUES (?, ?, ?, ?, ?, '', 'active', ?, ?)
  `).run(
    params.id,
    params.ownerUserId,
    params.providerType,
    normalizedBaseUrl,
    encryptSecret(params.apiKey),
    fingerprint,
    now_iso_()
  );

  return {
    ok: true,
    data: get_provider_credential_by_id(params.ownerUserId, params.id) as ProviderCredentialRow
  };
};

export const update_provider_credential_status = (params: {
  ownerUserId: string;
  credentialId: string;
  status: "active" | "disabled";
}): MutationResult<ProviderCredentialRow> => {
  const current = get_provider_credential_by_id(params.ownerUserId, params.credentialId);
  if (!current) {
    return { ok: false, code: "not_found", message: "credential not found for current user" };
  }

  if (params.status === "disabled") {
    const linkedEnabledOfferings = db.prepare(`
      SELECT COUNT(*) AS count
      FROM offerings
      WHERE owner_user_id = ? AND credential_id = ? AND enabled = 1
    `).get(params.ownerUserId, params.credentialId) as { count: number };

    if (linkedEnabledOfferings.count > 0) {
      return {
        ok: false,
        code: "risk_linked_enabled_offerings",
        message: "disable linked offerings before disabling this credential"
      };
    }
  }

  db.prepare(`
    UPDATE provider_credentials
    SET status = ?
    WHERE owner_user_id = ? AND id = ?
  `).run(params.status, params.ownerUserId, params.credentialId);

  return {
    ok: true,
    data: get_provider_credential_by_id(params.ownerUserId, params.credentialId) as ProviderCredentialRow
  };
};

export const list_provider_credentials = (ownerUserId: string): ProviderCredentialRow[] =>
  db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      provider_type AS providerType,
      base_url AS baseUrl,
      CASE WHEN encrypted_secret IS NOT NULL AND encrypted_secret != '' THEN 1 ELSE 0 END AS hasEncryptedSecret,
      api_key_env_name AS apiKeyEnvName,
      status
    FROM provider_credentials
    WHERE owner_user_id = ?
    ORDER BY id ASC
  `).all(ownerUserId).map((row) => {
    const typedRow = row as unknown as ProviderCredentialDbRow;
    return {
      ...typedRow,
      hasEncryptedSecret: typedRow.hasEncryptedSecret === 1
    };
  });

export const get_provider_credential_by_id = (
  ownerUserId: string,
  credentialId: string
): ProviderCredentialRow | null => {
  const row = db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      provider_type AS providerType,
      base_url AS baseUrl,
      CASE WHEN encrypted_secret IS NOT NULL AND encrypted_secret != '' THEN 1 ELSE 0 END AS hasEncryptedSecret,
      api_key_env_name AS apiKeyEnvName,
      status
    FROM provider_credentials
    WHERE owner_user_id = ? AND id = ?
    LIMIT 1
  `).get(ownerUserId, credentialId) as ProviderCredentialDbRow | undefined;

  if (!row) {
    return null;
  }

  return {
    ...row,
    hasEncryptedSecret: row.hasEncryptedSecret === 1
  };
};

export const get_offering_for_model = (logicalModel: string): OfferingRow | null => {
  const row = db
    .prepare(`
      SELECT
        o.id AS offeringId,
        o.owner_user_id AS ownerUserId,
        c.provider_type AS providerType,
        c.id AS credentialId,
        c.base_url AS baseUrl,
        c.encrypted_secret AS encryptedSecret,
        c.api_key_env_name AS apiKeyEnvName,
        o.real_model AS realModel,
        o.pricing_mode AS pricingMode,
        o.fixed_price_per_1k_input AS fixedPricePer1kInput,
        o.fixed_price_per_1k_output AS fixedPricePer1kOutput,
        o.review_status AS reviewStatus,
        60 AS qpsLimit,
        128000 AS maxContextTokens,
        0.99 AS successRate1h,
        1200 AS p95LatencyMs1h,
        0.01 AS recentErrorRate10m,
        o.enabled AS enabled,
        o.logical_model AS logicalModel
      FROM offerings o
      JOIN provider_credentials c ON c.id = o.credential_id
      WHERE o.logical_model = ? AND o.enabled = 1 AND o.review_status = 'approved' AND c.status = 'active'
        AND o.owner_user_id NOT LIKE '%_demo'
      ORDER BY o.id ASC
      LIMIT 1
    `)
    .get(logicalModel) as
    | {
        offeringId: string;
        ownerUserId: string;
        providerType: CandidateOffering["providerType"];
        credentialId: string;
        baseUrl?: string;
        encryptedSecret?: string | null;
        apiKeyEnvName: string;
        realModel: string;
        pricingMode: CandidateOffering["pricingMode"];
        fixedPricePer1kInput: number;
        fixedPricePer1kOutput: number;
        reviewStatus: "pending" | "approved" | "rejected";
        qpsLimit: number;
        maxContextTokens: number;
        successRate1h: number;
        p95LatencyMs1h: number;
        recentErrorRate10m: number;
        enabled: number;
        logicalModel: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    ...row,
    encryptedSecret: row.encryptedSecret ?? undefined,
    enabled: row.enabled === 1
  };
};

export const list_offerings_for_model = (logicalModel: string): OfferingRow[] =>
  db.prepare(`
    SELECT
      o.id AS offeringId,
      o.owner_user_id AS ownerUserId,
      c.provider_type AS providerType,
      c.id AS credentialId,
      c.base_url AS baseUrl,
      c.encrypted_secret AS encryptedSecret,
      c.api_key_env_name AS apiKeyEnvName,
      o.real_model AS realModel,
      o.pricing_mode AS pricingMode,
      o.fixed_price_per_1k_input AS fixedPricePer1kInput,
      o.fixed_price_per_1k_output AS fixedPricePer1kOutput,
      o.review_status AS reviewStatus,
      60 AS qpsLimit,
      128000 AS maxContextTokens,
      0.99 AS successRate1h,
      1200 AS p95LatencyMs1h,
      0.01 AS recentErrorRate10m,
      o.enabled AS enabled,
      o.logical_model AS logicalModel
    FROM offerings o
    JOIN provider_credentials c ON c.id = o.credential_id
    WHERE o.logical_model = ? AND o.enabled = 1 AND o.review_status = 'approved' AND c.status = 'active'
      AND o.owner_user_id NOT LIKE '%_demo'
    ORDER BY o.id ASC
  `).all(logicalModel).map((row) => {
    const typedRow = row as unknown as OfferingDbRow;
    return {
      ...typedRow,
      encryptedSecret: typedRow.encryptedSecret ?? undefined,
      enabled: typedRow.enabled === 1
    };
  });

export const list_active_models = (): LogicalModelRow[] => {
  const rows = db.prepare(`
    SELECT
      o.logical_model AS name,
      COUNT(*) AS offeringCount,
      SUM(CASE WHEN o.enabled = 1 THEN 1 ELSE 0 END) AS enabledOfferingCount,
      COUNT(DISTINCT o.credential_id) AS credentialCount,
      COUNT(DISTINCT o.owner_user_id) AS ownerCount,
      GROUP_CONCAT(DISTINCT o.owner_user_id) AS owners,
      MIN(o.fixed_price_per_1k_input) AS minInputPricePer1k,
      MIN(o.fixed_price_per_1k_output) AS minOutputPricePer1k,
      GROUP_CONCAT(DISTINCT c.provider_type) AS providers,
      GROUP_CONCAT(DISTINCT o.pricing_mode) AS pricingModes
    FROM offerings o
    JOIN provider_credentials c ON c.id = o.credential_id
    WHERE enabled = 1
      AND o.review_status = 'approved'
      AND c.status = 'active'
      AND o.owner_user_id NOT LIKE '%_demo'
    GROUP BY o.logical_model
    ORDER BY logical_model ASC
  `).all() as Array<{
    name: string;
    offeringCount: number;
    enabledOfferingCount: number;
    credentialCount: number;
    ownerCount: number;
    owners: string;
    minInputPricePer1k: number;
    minOutputPricePer1k: number;
    providers: string;
    pricingModes: string;
  }>;

  return rows.map((row) => {
    const ownerIds = row.owners ? row.owners.split(",") : [];
    const featuredSuppliers = ownerIds.slice(0, 3).map((ownerId) => {
      const supplier = db.prepare(`
        SELECT handle, display_name AS displayName
        FROM users
        WHERE id = ?
        LIMIT 1
      `).get(ownerId) as { handle: string; displayName: string } | undefined;

      return supplier ?? { handle: ownerId, displayName: ownerId };
    });

    return {
      logicalModel: row.name,
      providers: row.providers ? row.providers.split(",") : [],
      providerCount: row.providers ? row.providers.split(",").length : 0,
      ownerCount: row.ownerCount,
      enabledOfferingCount: row.enabledOfferingCount,
      credentialCount: row.credentialCount,
      pricingModes: (row.pricingModes ? row.pricingModes.split(",") : []) as PricingMode[],
      minInputPrice: row.minInputPricePer1k ?? null,
      minOutputPrice: row.minOutputPricePer1k ?? null,
      status: row.enabledOfferingCount > 0 ? "available" : "limited",
      capabilities: ["chat"],
      compatibilities: ["openai", "anthropic"] as Array<"openai" | "anthropic">,
      featuredSuppliers
    };
  });
};

export const get_public_supplier_profile = (handle: string): PublicSupplierProfile | null => {
  const row = db.prepare(`
    SELECT
      u.id,
      u.handle,
      u.display_name AS displayName,
      u.status,
      COUNT(DISTINCT CASE WHEN o.enabled = 1 AND o.review_status = 'approved' AND c.status = 'active' THEN o.id END) AS activeOfferingCount,
      COUNT(DISTINCT ar.requester_user_id) AS servedUserCount,
      COUNT(ar.id) AS totalRequestCount,
      COALESCE(SUM(ar.total_tokens), 0) AS totalSupplyTokens,
      MIN(CASE WHEN o.enabled = 1 AND o.review_status = 'approved' THEN o.created_at END) AS firstApprovedAt,
      MAX(ar.created_at) AS lastActiveAt
    FROM users u
    LEFT JOIN offerings o ON o.owner_user_id = u.id
    LEFT JOIN provider_credentials c ON c.id = o.credential_id
    LEFT JOIN api_requests ar ON ar.chosen_offering_id = o.id
    WHERE u.handle = ?
    GROUP BY u.id, u.handle, u.display_name, u.status
    LIMIT 1
  `).get(handle) as {
    id: string;
    handle: string;
    displayName: string;
    status: string;
    activeOfferingCount: number;
    servedUserCount: number;
    totalRequestCount: number;
    totalSupplyTokens: number;
    firstApprovedAt: string | null;
    lastActiveAt: string | null;
  } | undefined;

  if (!row) {
    return null;
  }

  const stableSeconds = row.firstApprovedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(row.firstApprovedAt)) / 1000))
    : 0;

  return {
    handle: row.handle,
    displayName: row.displayName,
    status: row.status === "active" ? "active" : "inactive",
    activeOfferingCount: row.activeOfferingCount,
    servedUserCount: row.servedUserCount,
    totalRequestCount: row.totalRequestCount,
    totalSupplyTokens: row.totalSupplyTokens,
    totalStableSeconds: stableSeconds,
    lastActiveAt: row.lastActiveAt
  };
};

export const get_public_supplier_offerings = (handle: string): PublicSupplierOffering[] =>
  db.prepare(`
    SELECT
      o.id,
      o.logical_model AS logicalModel,
      o.real_model AS realModel,
      c.provider_type AS providerType,
      o.fixed_price_per_1k_input AS inputPricePer1k,
      o.fixed_price_per_1k_output AS outputPricePer1k,
      COUNT(DISTINCT ar.requester_user_id) AS servedUserCount,
      COUNT(ar.id) AS requestCount,
      COALESCE(SUM(ar.total_tokens), 0) AS totalSupplyTokens,
      o.created_at AS createdAt,
      o.enabled
    FROM offerings o
    JOIN users u ON u.id = o.owner_user_id
    JOIN provider_credentials c ON c.id = o.credential_id
    LEFT JOIN api_requests ar ON ar.chosen_offering_id = o.id
    WHERE u.handle = ?
      AND o.enabled = 1
      AND o.review_status = 'approved'
      AND c.status = 'active'
    GROUP BY o.id, o.logical_model, o.real_model, c.provider_type, o.fixed_price_per_1k_input,
      o.fixed_price_per_1k_output, o.created_at, o.enabled
    ORDER BY o.logical_model ASC
  `).all(handle).map((row) => {
    const typed = row as {
      id: string;
      logicalModel: string;
      realModel: string;
      providerType: "openai_compatible" | "anthropic" | "openai";
      inputPricePer1k: number;
      outputPricePer1k: number;
      servedUserCount: number;
      requestCount: number;
      totalSupplyTokens: number;
      createdAt: string;
      enabled: number;
    };
    return {
      id: typed.id,
      logicalModel: typed.logicalModel,
      realModel: typed.realModel,
      providerType: typed.providerType,
      compatibilities: ["openai", "anthropic"] as Array<"openai" | "anthropic">,
      inputPricePer1k: typed.inputPricePer1k,
      outputPricePer1k: typed.outputPricePer1k,
      servedUserCount: typed.servedUserCount,
      requestCount: typed.requestCount,
      totalSupplyTokens: typed.totalSupplyTokens,
      stableSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(typed.createdAt)) / 1000)),
      enabled: typed.enabled === 1
    };
  });

export const get_supply_usage = (userId: string) => {
  const summary = db.prepare(`
    SELECT
      COUNT(ar.id) AS requestCount,
      COALESCE(SUM(ar.input_tokens), 0) AS inputTokens,
      COALESCE(SUM(ar.output_tokens), 0) AS outputTokens,
      COALESCE(SUM(ar.total_tokens), 0) AS totalTokens,
      COALESCE(SUM(sr.supplier_reward), 0) AS supplierReward
    FROM offerings o
    LEFT JOIN api_requests ar ON ar.chosen_offering_id = o.id
    LEFT JOIN settlement_records sr ON sr.request_id = ar.id
    WHERE o.owner_user_id = ?
  `).get(userId) as {
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    supplierReward: number;
  };

  const items = db.prepare(`
    SELECT
      o.id AS offeringId,
      o.logical_model AS logicalModel,
      o.real_model AS realModel,
      COUNT(ar.id) AS requestCount,
      COALESCE(SUM(ar.input_tokens), 0) AS inputTokens,
      COALESCE(SUM(ar.output_tokens), 0) AS outputTokens,
      COALESCE(SUM(ar.total_tokens), 0) AS totalTokens,
      COALESCE(SUM(sr.supplier_reward), 0) AS supplierReward
    FROM offerings o
    LEFT JOIN api_requests ar ON ar.chosen_offering_id = o.id
    LEFT JOIN settlement_records sr ON sr.request_id = ar.id
    WHERE o.owner_user_id = ?
    GROUP BY o.id, o.logical_model, o.real_model
    ORDER BY totalTokens DESC, o.logical_model ASC
  `).all(userId);

  return { summary, items };
};

export const get_consumption_usage = (userId: string) => {
  const summary = db.prepare(`
    SELECT
      COUNT(ar.id) AS requestCount,
      COALESCE(SUM(ar.input_tokens), 0) AS inputTokens,
      COALESCE(SUM(ar.output_tokens), 0) AS outputTokens,
      COALESCE(SUM(ar.total_tokens), 0) AS totalTokens,
      COALESCE(SUM(sr.consumer_cost), 0) AS consumerCost
    FROM api_requests ar
    LEFT JOIN settlement_records sr ON sr.request_id = ar.id
    WHERE ar.requester_user_id = ?
  `).get(userId) as {
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    consumerCost: number;
  };

  const items = db.prepare(`
    SELECT
      logical_model AS logicalModel,
      COUNT(id) AS requestCount,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      MAX(created_at) AS lastUsedAt
    FROM api_requests
    WHERE requester_user_id = ?
    GROUP BY logical_model
    ORDER BY totalTokens DESC, logical_model ASC
  `).all(userId);

  return { summary, items };
};

export const get_consumption_daily = (userId: string, year: number) => {
  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;
  return db.prepare(`
    SELECT
      SUBSTR(created_at, 1, 10) AS date,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COUNT(id) AS requestCount
    FROM api_requests
    WHERE requester_user_id = ?
      AND created_at >= ? AND created_at < ?
    GROUP BY SUBSTR(created_at, 1, 10)
    ORDER BY date ASC
  `).all(userId, startDate, endDate) as Array<{ date: string; totalTokens: number; requestCount: number }>;
};

export const get_consumption_by_date = (userId: string, date: string) => {
  return db.prepare(`
    SELECT
      logical_model AS logicalModel,
      COUNT(id) AS requestCount,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens
    FROM api_requests
    WHERE requester_user_id = ?
      AND SUBSTR(created_at, 1, 10) = ?
    GROUP BY logical_model
    ORDER BY totalTokens DESC
  `).all(userId, date) as Array<{ logicalModel: string; requestCount: number; inputTokens: number; outputTokens: number; totalTokens: number }>;
};

export const get_consumption_recent = (userId: string, days: number = 30, limit: number = 500) => {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const since = sinceDate.toISOString().slice(0, 10);
  return db.prepare(`
    SELECT
      id AS requestId,
      logical_model AS logicalModel,
      provider,
      real_model AS realModel,
      MIN(input_tokens, 2147483647) AS inputTokens,
      MIN(output_tokens, 2147483647) AS outputTokens,
      MIN(total_tokens, 2147483647) AS totalTokens,
      created_at AS createdAt
    FROM api_requests
    WHERE requester_user_id = ?
      AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, since, limit) as Array<{
    requestId: string;
    logicalModel: string;
    provider: string;
    realModel: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    createdAt: string;
  }>;
};

export const get_admin_usage_summary = () => {
  const summary = db.prepare(`
    SELECT
      COUNT(id) AS totalRequests,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COUNT(DISTINCT requester_user_id) AS consumerCount,
      COUNT(DISTINCT chosen_offering_id) AS offeringCount
    FROM api_requests
  `).get() as {
    totalRequests: number;
    totalTokens: number;
    consumerCount: number;
    offeringCount: number;
  };

  const topModels = db.prepare(`
    SELECT
      logical_model AS logicalModel,
      COUNT(id) AS requestCount,
      COALESCE(SUM(total_tokens), 0) AS totalTokens
    FROM api_requests
    GROUP BY logical_model
    ORDER BY totalTokens DESC
    LIMIT 10
  `).all();

  return { summary, topModels };
};

export const get_admin_market_summary = () => ({
  models: list_active_models(),
  pendingCount: (db.prepare("SELECT COUNT(*) AS count FROM offerings WHERE review_status = 'pending'").get() as { count: number }).count
});

const ensure_wallet_ = (userId: string) => {
  db.prepare(
    "INSERT INTO wallets (user_id, available_token_credit) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING"
  ).run(userId, DEFAULT_INITIAL_TOKEN_CREDIT);
};

export const record_chat_settlement = (params: {
  requestId: string;
  requesterUserId: string;
  supplierUserId: string;
  logicalModel: string;
  idempotencyKey?: string | null;
  offeringId: string;
  provider: string;
  realModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  fixedPricePer1kInput: number;
  fixedPricePer1kOutput: number;
  responseBody?: unknown;
}) => {
  const MAX_TOKENS = 2_147_483_647;
  const clamp = (n: number) => Math.min(Math.max(Math.round(n) || 0, 0), MAX_TOKENS);
  params.inputTokens = clamp(params.inputTokens);
  params.outputTokens = clamp(params.outputTokens);
  params.totalTokens = clamp(params.totalTokens);

  const inputCost = Math.ceil((params.inputTokens * params.fixedPricePer1kInput) / 1000);
  const outputCost = Math.ceil((params.outputTokens * params.fixedPricePer1kOutput) / 1000);
  const consumerCost = inputCost + outputCost;
  const rateRow = db.prepare("SELECT value FROM platform_config WHERE key = 'supplier_reward_rate'").get() as { value: string } | undefined;
  const supplierRewardRate = rateRow?.value ? Number(rateRow.value) : 0.85;
  const supplierReward = Math.floor(consumerCost * supplierRewardRate);
  const platformMargin = consumerCost - supplierReward;
  const now = new Date().toISOString();

  db.exec("BEGIN");

  try {
    ensure_wallet_(params.requesterUserId);
    ensure_wallet_(params.supplierUserId);

    db.prepare(`
      INSERT INTO api_requests (
        id, requester_user_id, logical_model, chosen_offering_id, provider, real_model,
        input_tokens, output_tokens, total_tokens, status, idempotency_key, response_body, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
    `).run(
      params.requestId,
      params.requesterUserId,
      params.logicalModel,
      params.offeringId,
      params.provider,
      params.realModel,
      params.inputTokens,
      params.outputTokens,
      params.totalTokens,
      params.idempotencyKey ?? null,
      params.responseBody ? JSON.stringify(params.responseBody) : null,
      now
    );

    db.prepare(
      "UPDATE wallets SET available_token_credit = available_token_credit - ? WHERE user_id = ?"
    ).run(consumerCost, params.requesterUserId);
    db.prepare(
      "UPDATE wallets SET available_token_credit = available_token_credit + ? WHERE user_id = ?"
    ).run(supplierReward, params.supplierUserId);

    db.prepare(`
      INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type, created_at)
      VALUES (?, ?, 'debit', ?, 'consumer_cost', ?)
    `).run(params.requestId, params.requesterUserId, consumerCost, now);

    db.prepare(`
      INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type, created_at)
      VALUES (?, ?, 'credit', ?, 'supplier_reward', ?)
    `).run(params.requestId, params.supplierUserId, supplierReward, now);

    db.prepare(`
      INSERT INTO settlement_records (
        request_id, consumer_user_id, supplier_user_id, consumer_cost, supplier_reward, platform_margin, supplier_reward_rate, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.requestId,
      params.requesterUserId,
      params.supplierUserId,
      consumerCost,
      supplierReward,
      platformMargin,
      supplierRewardRate,
      now
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const record_settlement_failure = (params: {
  requestId: string;
  requesterUserId: string;
  supplierUserId: string;
  logicalModel: string;
  idempotencyKey?: string | null;
  offeringId: string;
  provider: string;
  realModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  fixedPricePer1kInput: number;
  fixedPricePer1kOutput: number;
  responseBody?: unknown;
  errorMessage: string;
}) => {
  const now = now_iso_();
  db.prepare(`
    INSERT INTO settlement_failures (
      id,
      request_id,
      requester_user_id,
      supplier_user_id,
      logical_model,
      offering_id,
      provider,
      real_model,
      error_message,
      settlement_payload,
      failure_count,
      first_failed_at,
      last_failed_at,
      resolved_at,
      resolved_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL)
    ON CONFLICT(request_id) DO UPDATE SET
      requester_user_id = excluded.requester_user_id,
      supplier_user_id = excluded.supplier_user_id,
      logical_model = excluded.logical_model,
      offering_id = excluded.offering_id,
      provider = excluded.provider,
      real_model = excluded.real_model,
      error_message = excluded.error_message,
      settlement_payload = excluded.settlement_payload,
      failure_count = settlement_failures.failure_count + 1,
      last_failed_at = excluded.last_failed_at,
      resolved_at = NULL,
      resolved_by = NULL
  `).run(
    `settlefail_${randomUUID().replaceAll("-", "")}`,
    params.requestId,
    params.requesterUserId,
    params.supplierUserId,
    params.logicalModel,
    params.offeringId,
    params.provider,
    params.realModel,
    params.errorMessage,
    JSON.stringify({
      requestId: params.requestId,
      requesterUserId: params.requesterUserId,
      supplierUserId: params.supplierUserId,
      logicalModel: params.logicalModel,
      idempotencyKey: params.idempotencyKey ?? null,
      offeringId: params.offeringId,
      provider: params.provider,
      realModel: params.realModel,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.totalTokens,
      fixedPricePer1kInput: params.fixedPricePer1kInput,
      fixedPricePer1kOutput: params.fixedPricePer1kOutput,
      responseBody: params.responseBody ?? null
    }),
    now,
    now
  );
};

export const list_admin_settlement_failures = (params: {
  page: number;
  limit: number;
  status?: "open" | "resolved" | "all";
}) => {
  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (!params.status || params.status === "open") {
    conditions.push("sf.resolved_at IS NULL");
  } else if (params.status === "resolved") {
    conditions.push("sf.resolved_at IS NOT NULL");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (params.page - 1) * params.limit;

  const data = db.prepare(`
    SELECT
      sf.id,
      sf.request_id AS requestId,
      sf.requester_user_id AS requesterUserId,
      sf.supplier_user_id AS supplierUserId,
      sf.logical_model AS logicalModel,
      sf.offering_id AS offeringId,
      sf.provider,
      sf.real_model AS realModel,
      sf.error_message AS errorMessage,
      sf.failure_count AS failureCount,
      sf.first_failed_at AS firstFailedAt,
      sf.last_failed_at AS lastFailedAt,
      sf.resolved_at AS resolvedAt,
      sf.resolved_by AS resolvedBy,
      ui.email AS requesterEmail,
      si.email AS supplierEmail
    FROM settlement_failures sf
    LEFT JOIN user_identities ui ON ui.user_id = sf.requester_user_id
    LEFT JOIN user_identities si ON si.user_id = sf.supplier_user_id
    ${whereClause}
    ORDER BY sf.last_failed_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, params.limit, offset);

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM settlement_failures sf
    ${whereClause}
  `).get(...values) as { total: number };

  return { data, total: Number(totalRow?.total ?? 0) };
};

export const retry_settlement_failure = (params: {
  failureId: string;
  actorUserId: string;
}) => {
  const failure = db.prepare(`
    SELECT id, request_id AS requestId, settlement_payload AS settlementPayload
    FROM settlement_failures
    WHERE id = ?
    LIMIT 1
  `).get(params.failureId) as { id: string; requestId: string; settlementPayload: string } | undefined;

  if (!failure) {
    return { ok: false as const, code: "not_found", message: "settlement failure not found" };
  }

  const existingSettlement = db.prepare("SELECT 1 FROM settlement_records WHERE request_id = ? LIMIT 1").get(failure.requestId);
  if (existingSettlement) {
    db.prepare(`
      UPDATE settlement_failures
      SET resolved_at = ?, resolved_by = ?
      WHERE id = ?
    `).run(now_iso_(), params.actorUserId, failure.id);
    return { ok: true as const, data: { status: "already_settled" } };
  }

  const payload = JSON.parse(failure.settlementPayload) as {
    requestId: string;
    requesterUserId: string;
    supplierUserId: string;
    logicalModel: string;
    idempotencyKey?: string | null;
    offeringId: string;
    provider: string;
    realModel: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    fixedPricePer1kInput: number;
    fixedPricePer1kOutput: number;
    responseBody?: unknown;
  };

  try {
    record_chat_settlement(payload);
    db.prepare(`
      UPDATE settlement_failures
      SET resolved_at = ?, resolved_by = ?
      WHERE id = ?
    `).run(now_iso_(), params.actorUserId, failure.id);
    return { ok: true as const, data: { status: "retried" } };
  } catch (error) {
    record_settlement_failure({
      ...payload,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    return { ok: false as const, code: "retry_failed", message: error instanceof Error ? error.message : "retry failed" };
  }
};

export const create_offering = (params: {
  id: string;
  ownerUserId: string;
  logicalModel: string;
  credentialId: string;
  realModel: string;
  pricingMode: CandidateOffering["pricingMode"];
  fixedPricePer1kInput: number;
  fixedPricePer1kOutput: number;
}) => {
  db.prepare(`
    INSERT INTO offerings (
      id, owner_user_id, logical_model, credential_id, real_model, pricing_mode,
      fixed_price_per_1k_input, fixed_price_per_1k_output, enabled, review_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'approved', ?)
  `).run(
    params.id,
    params.ownerUserId,
    params.logicalModel,
    params.credentialId,
    params.realModel,
    params.pricingMode,
    params.fixedPricePer1kInput,
    params.fixedPricePer1kOutput,
    now_iso_()
  );

  return get_offering_by_id(params.ownerUserId, params.id);
};

export const update_offering = (params: {
  ownerUserId: string;
  offeringId: string;
  pricingMode?: CandidateOffering["pricingMode"];
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  enabled?: boolean;
}): MutationResult<ReturnType<typeof get_offering_by_id>> => {
  const current = get_offering_by_id(params.ownerUserId, params.offeringId) as
    | {
        credentialId: string;
        pricingMode: CandidateOffering["pricingMode"];
        fixedPricePer1kInput: number;
        fixedPricePer1kOutput: number;
        enabled: number;
      }
    | undefined;

  if (!current) {
    return { ok: false, code: "not_found", message: "offering not found for current user" };
  }

  if (params.enabled === true) {
    const credential = get_provider_credential_by_id(params.ownerUserId, current.credentialId);
    if (!credential || credential.status !== "active") {
      return {
        ok: false,
        code: "risk_inactive_credential",
        message: "activate the linked credential before enabling this offering"
      };
    }
  }

  db.prepare(`
    UPDATE offerings
    SET
      pricing_mode = ?,
      fixed_price_per_1k_input = ?,
      fixed_price_per_1k_output = ?,
      enabled = ?
    WHERE owner_user_id = ? AND id = ?
  `).run(
    params.pricingMode ?? current.pricingMode,
    params.fixedPricePer1kInput ?? current.fixedPricePer1kInput,
    params.fixedPricePer1kOutput ?? current.fixedPricePer1kOutput,
    params.enabled === undefined ? current.enabled : params.enabled ? 1 : 0,
    params.ownerUserId,
    params.offeringId
  );

  return {
    ok: true,
    data: get_offering_by_id(params.ownerUserId, params.offeringId)
  };
};

export const remove_offering = (params: {
  ownerUserId: string;
  offeringId: string;
}) => {
  const current = get_offering_by_id(params.ownerUserId, params.offeringId) as
    | {
        id: string;
        enabled: number;
      }
    | undefined;

  if (!current) {
    return { ok: false as const, code: "not_found", message: "offering not found for current user" };
  }

  if (current.enabled === 1) {
    return { ok: false as const, code: "risk_active_offering", message: "disable offering before deleting it" };
  }

  const requestCount = db.prepare(
    "SELECT COUNT(*) AS count FROM api_requests WHERE chosen_offering_id = ?"
  ).get(params.offeringId) as { count: number };

  if (requestCount.count > 0) {
    return {
      ok: false as const,
      code: "risk_historical_requests",
      message: "offering has historical requests and cannot be deleted"
    };
  }

  db.prepare("DELETE FROM offerings WHERE owner_user_id = ? AND id = ?").run(params.ownerUserId, params.offeringId);
  return { ok: true as const };
};

export const remove_provider_credential = (params: {
  ownerUserId: string;
  credentialId: string;
}) => {
  const credential = get_provider_credential_by_id(params.ownerUserId, params.credentialId);
  if (!credential) {
    return { ok: false as const, code: "not_found", message: "credential not found for current user" };
  }

  if (credential.status !== "disabled") {
    return {
      ok: false as const,
      code: "risk_active_credential",
      message: "disable credential before deleting it"
    };
  }

  const activeOfferings = db.prepare(`
    SELECT COUNT(*) AS count
    FROM offerings
    WHERE owner_user_id = ? AND credential_id = ?
  `).get(params.ownerUserId, params.credentialId) as { count: number };

  if (activeOfferings.count > 0) {
    return {
      ok: false as const,
      code: "risk_linked_offerings",
      message: "delete linked offerings before deleting this credential"
    };
  }

  db.prepare("DELETE FROM provider_credentials WHERE owner_user_id = ? AND id = ?").run(
    params.ownerUserId,
    params.credentialId
  );

  return { ok: true as const };
};

export const list_offerings = (ownerUserId: string) =>
  db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      logical_model AS logicalModel,
      credential_id AS credentialId,
      real_model AS realModel,
      pricing_mode AS pricingMode,
      fixed_price_per_1k_input AS fixedPricePer1kInput,
      fixed_price_per_1k_output AS fixedPricePer1kOutput,
      enabled,
      review_status AS reviewStatus,
      created_at AS createdAt
    FROM offerings
    WHERE owner_user_id = ?
    ORDER BY created_at DESC
  `).all(ownerUserId);

export const get_offering_by_id = (ownerUserId: string, offeringId: string) =>
  db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      logical_model AS logicalModel,
      credential_id AS credentialId,
      real_model AS realModel,
      pricing_mode AS pricingMode,
      fixed_price_per_1k_input AS fixedPricePer1kInput,
      fixed_price_per_1k_output AS fixedPricePer1kOutput,
      enabled,
      review_status AS reviewStatus
    FROM offerings
    WHERE owner_user_id = ? AND id = ?
    LIMIT 1
  `).get(ownerUserId, offeringId);

export const list_pending_offerings = () =>
  db.prepare(`
    SELECT
      o.id,
      o.owner_user_id AS ownerUserId,
      o.logical_model AS logicalModel,
      o.credential_id AS credentialId,
      o.real_model AS realModel,
      o.pricing_mode AS pricingMode,
      o.fixed_price_per_1k_input AS fixedPricePer1kInput,
      o.fixed_price_per_1k_output AS fixedPricePer1kOutput,
      o.enabled,
      o.review_status AS reviewStatus,
      c.provider_type AS providerType,
      c.base_url AS baseUrl,
      c.status AS credentialStatus
    FROM offerings o
    JOIN provider_credentials c ON c.id = o.credential_id
    WHERE o.review_status = 'pending'
    ORDER BY o.id ASC
  `).all();

export const review_offering = (params: {
  offeringId: string;
  reviewStatus: "approved" | "rejected";
}): MutationResult<Record<string, unknown>> => {
  const existing = db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      review_status AS reviewStatus
    FROM offerings
    WHERE id = ?
    LIMIT 1
  `).get(params.offeringId) as { id: string; ownerUserId: string; reviewStatus: string } | undefined;

  if (!existing) {
    return { ok: false, code: "not_found", message: "offering not found" };
  }

  db.prepare(`
    UPDATE offerings
    SET review_status = ?, enabled = CASE WHEN ? = 'approved' THEN enabled ELSE 0 END
    WHERE id = ?
  `).run(params.reviewStatus, params.reviewStatus, params.offeringId);

  return {
    ok: true,
    data: db.prepare(`
      SELECT
        id,
        owner_user_id AS ownerUserId,
        logical_model AS logicalModel,
        review_status AS reviewStatus,
        enabled
      FROM offerings
      WHERE id = ?
      LIMIT 1
    `).get(params.offeringId) as Record<string, unknown>
  };
};

export const write_audit_log = (params: {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  payload: unknown;
}) => {
  db.prepare(`
    INSERT INTO audit_logs (
      actor_user_id, action, target_type, target_id, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    params.actorUserId,
    params.action,
    params.targetType,
    params.targetId,
    JSON.stringify(params.payload ?? {}),
    new Date().toISOString()
  );
};

export const record_email_delivery_attempt = (params: {
  id: string;
  provider: string;
  templateKey: string;
  toEmail: string;
  subject: string;
  challengeId?: string | null;
  status: "queued" | "sent" | "failed" | "delivered" | "bounced" | "complained";
  providerMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  payload?: unknown;
}) => {
  const now = now_iso_();
  db.prepare(`
    INSERT INTO email_delivery_attempts (
      id, provider, template_key, to_email, subject, challenge_id, status,
      provider_message_id, error_code, error_message, payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.provider,
    params.templateKey,
    normalize_email_(params.toEmail),
    params.subject,
    params.challengeId ?? null,
    params.status,
    params.providerMessageId ?? null,
    params.errorCode ?? null,
    params.errorMessage ?? null,
    params.payload ? JSON.stringify(params.payload) : null,
    now,
    now
  );
};

export const record_security_event = (params: {
  id: string;
  userId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  ipAddress?: string | null;
  userAgent?: string | null;
  payload?: unknown;
}) => {
  db.prepare(`
    INSERT INTO security_events (
      id, user_id, type, severity, ip_address, user_agent, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.userId,
    params.type,
    params.severity,
    params.ipAddress ?? null,
    params.userAgent ?? null,
    params.payload ? JSON.stringify(params.payload) : null,
    now_iso_()
  );
};

export const list_admin_email_deliveries = (limit = 100) =>
  db.prepare(`
    SELECT
      id,
      provider,
      template_key AS templateKey,
      to_email AS toEmail,
      subject,
      challenge_id AS challengeId,
      status,
      provider_message_id AS providerMessageId,
      error_code AS errorCode,
      error_message AS errorMessage,
      payload,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM email_delivery_attempts
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit).map((row: any) => ({
    ...row,
    payload: row.payload ? JSON.parse(row.payload) : null
  }));

export const list_admin_security_events = (limit = 100) =>
  db.prepare(`
    SELECT
      se.id,
      se.user_id AS userId,
      i.email,
      se.type,
      se.severity,
      se.ip_address AS ipAddress,
      se.user_agent AS userAgent,
      se.payload,
      se.created_at AS createdAt
    FROM security_events se
    LEFT JOIN user_identities i ON i.user_id = se.user_id
    ORDER BY se.created_at DESC
    LIMIT ?
  `).all(limit).map((row: any) => ({
    ...row,
    payload: row.payload ? JSON.parse(row.payload) : null
  }));

export const find_cached_response = (params: {
  requesterUserId: string;
  idempotencyKey: string;
}) => {
  const row = db.prepare(`
    SELECT response_body AS responseBody
    FROM api_requests
    WHERE requester_user_id = ? AND idempotency_key = ? AND response_body IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(params.requesterUserId, params.idempotencyKey) as { responseBody: string } | undefined;

  if (!row) {
    return null;
  }

  return JSON.parse(row.responseBody);
};

export const create_chat_conversation = (params: {
  id: string;
  ownerUserId: string;
  logicalModel: string;
  title?: string | null;
}) => {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO chat_conversations (id, owner_user_id, logical_model, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(params.id, params.ownerUserId, params.logicalModel, params.title ?? null, now, now);
  return db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      logical_model AS logicalModel,
      title,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM chat_conversations
    WHERE id = ?
    LIMIT 1
  `).get(params.id);
};

export const get_chat_conversation = (params: {
  ownerUserId: string;
  conversationId: string;
}) => {
  return db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      logical_model AS logicalModel,
      title,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM chat_conversations
    WHERE owner_user_id = ? AND id = ?
    LIMIT 1
  `).get(params.ownerUserId, params.conversationId);
};

export const list_chat_conversations = (params: {
  ownerUserId: string;
  logicalModel: string;
  limit?: number;
}) => {
  return db.prepare(`
    SELECT
      c.id,
      c.logical_model AS logicalModel,
      c.title,
      c.created_at AS createdAt,
      c.updated_at AS updatedAt,
      (
        SELECT m.content
        FROM chat_messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS lastMessage
    FROM chat_conversations c
    WHERE c.owner_user_id = ? AND c.logical_model = ?
    ORDER BY c.updated_at DESC
    LIMIT ?
  `).all(params.ownerUserId, params.logicalModel, params.limit ?? 100);
};

export const list_chat_messages = (params: {
  ownerUserId: string;
  conversationId: string;
  limit?: number;
}) => {
  return db.prepare(`
    SELECT
      m.id,
      m.conversation_id AS conversationId,
      m.role,
      m.content,
      m.request_id AS requestId,
      m.created_at AS createdAt
    FROM chat_messages m
    JOIN chat_conversations c ON c.id = m.conversation_id
    WHERE c.owner_user_id = ? AND m.conversation_id = ?
    ORDER BY m.created_at ASC
    LIMIT ?
  `).all(params.ownerUserId, params.conversationId, params.limit ?? 500);
};

export const append_chat_message = (params: {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  requestId?: string | null;
}) => {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO chat_messages (id, conversation_id, role, content, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(params.id, params.conversationId, params.role, params.content, params.requestId ?? null, now);
    db.prepare(`
      UPDATE chat_conversations
      SET updated_at = ?
      WHERE id = ?
    `).run(now, params.conversationId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const delete_chat_conversation = (params: {
  conversationId: string;
  ownerUserId: string;
}) => {
  db.exec("BEGIN");
  try {
    db.prepare(`
      DELETE FROM chat_messages WHERE conversation_id = ?
    `).run(params.conversationId);
    const result = db.prepare(`
      DELETE FROM chat_conversations WHERE id = ? AND owner_user_id = ?
    `).run(params.conversationId, params.ownerUserId);
    db.exec("COMMIT");
    return Number(result.changes);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const update_chat_conversation_title = (params: {
  conversationId: string;
  ownerUserId: string;
  title: string;
}) => {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?
  `).run(params.title, now, params.conversationId, params.ownerUserId);
  return db.prepare(`
    SELECT
      id,
      owner_user_id AS ownerUserId,
      logical_model AS logicalModel,
      title,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM chat_conversations
    WHERE id = ? AND owner_user_id = ?
    LIMIT 1
  `).get(params.conversationId, params.ownerUserId);
};

export const get_debug_state = () => ({
  apiKeys: db.prepare("SELECT id, user_id, label, status FROM platform_api_keys ORDER BY id ASC").all(),
  auditLogs: db.prepare("SELECT actor_user_id, action, target_type, target_id, created_at FROM audit_logs ORDER BY id DESC LIMIT 20").all(),
  wallets: db.prepare("SELECT * FROM wallets ORDER BY user_id ASC").all(),
  offerings: db.prepare(`
    SELECT
      o.id,
      o.logical_model,
      o.real_model,
      o.enabled,
      o.review_status,
      c.provider_type,
      CASE WHEN c.encrypted_secret IS NOT NULL AND c.encrypted_secret != '' THEN 1 ELSE 0 END AS has_encrypted_secret,
      c.api_key_env_name
    FROM offerings o
    JOIN provider_credentials c ON c.id = o.credential_id
    ORDER BY o.id ASC
  `).all()
});
