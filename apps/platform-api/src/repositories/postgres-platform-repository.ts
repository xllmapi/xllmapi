import { Pool } from "pg";
import { randomInt, randomUUID } from "node:crypto";

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

import { config } from "../config.js";
import { DEFAULT_AVATAR_URL, DEFAULT_INITIAL_TOKEN_CREDIT, DEV_ADMIN_API_KEY, DEV_USER_API_KEY } from "../constants.js";
import { encryptSecret, hashApiKey, hashPassword } from "../crypto-utils.js";
import type { PlatformRepository } from "./platform-repository.js";

type ProviderCredentialRow = {
  id: string;
  ownerUserId: string;
  providerType: CandidateOffering["providerType"];
  baseUrl: string | null;
  hasEncryptedSecret: boolean;
  apiKeyEnvName: string;
  status: string;
};

type OfferingListRow = {
  id: string;
  ownerUserId: string;
  logicalModel: string;
  credentialId: string;
  realModel: string;
  pricingMode: CandidateOffering["pricingMode"];
  fixedPricePer1kInput: number;
  fixedPricePer1kOutput: number;
  enabled: boolean;
  reviewStatus: "pending" | "approved" | "rejected";
};

type OfferingExecutionRow = CandidateOffering & {
  logicalModel: string;
  apiKeyEnvName: string;
  encryptedSecret?: string | null;
  reviewStatus: "pending" | "approved" | "rejected";
};

let pool: Pool | null = null;

const DEEPSEEK_API_KEY = process.env.XLLMAPI_DEEPSEEK_API_KEY ?? null;

const getPool = () => {
  if (pool) {
    return pool;
  }

  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required when XLLMAPI_DB_DRIVER=postgres");
  }

  pool = new Pool({
    connectionString: config.databaseUrl
  });

  return pool;
};

const getOfferingById = async (ownerUserId: string, offeringId: string): Promise<OfferingListRow | null> => {
  const currentPool = getPool();
  const result = await currentPool.query<OfferingListRow>(`
    SELECT
      id,
      owner_user_id AS "ownerUserId",
      logical_model AS "logicalModel",
      credential_id AS "credentialId",
      real_model AS "realModel",
      pricing_mode AS "pricingMode",
      fixed_price_per_1k_input AS "fixedPricePer1kInput",
      fixed_price_per_1k_output AS "fixedPricePer1kOutput",
      enabled,
      review_status AS "reviewStatus",
      created_at AS "createdAt"
    FROM offerings
    WHERE owner_user_id = $1 AND id = $2
    LIMIT 1
  `, [ownerUserId, offeringId]);

  return result.rows[0] ?? null;
};

const nowIso = () => new Date().toISOString();

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizeBaseUrl = (baseUrl?: string | null) => {
  const normalized = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
};
const providerKeyFingerprint = (params: {
  providerType: CandidateOffering["providerType"];
  baseUrl?: string | null;
  apiKey: string;
}) =>
  hashApiKey(`${params.providerType}|${(normalizeBaseUrl(params.baseUrl) ?? "").toLowerCase()}|${params.apiKey.trim()}`);

const generateCode = () => String(randomInt(100000, 1000000));

const getMeProfile = async (userId: string): Promise<MeProfile | null> => {
  const currentPool = getPool();
  const result = await currentPool.query<{
    id: string;
    email: string;
    displayName: string;
    handle: string;
    role: "user" | "admin";
    avatarUrl: string | null;
    phone: string | null;
    hasPassword: boolean;
  }>(`
    SELECT
      u.id,
      i.email,
      u.display_name AS "displayName",
      u.handle,
      u.role,
      u.avatar_url AS "avatarUrl",
      u.phone,
      CASE WHEN p.user_id IS NULL THEN FALSE ELSE TRUE END AS "hasPassword"
    FROM users u
    JOIN user_identities i ON i.user_id = u.id
    LEFT JOIN user_passwords p ON p.user_id = u.id
    WHERE u.id = $1
    LIMIT 1
  `, [userId]);

  if (!result.rows[0]) {
    return null;
  }

  return {
    ...result.rows[0],
    inviteStatus: "active",
    avatarUrl: result.rows[0].avatarUrl ?? DEFAULT_AVATAR_URL,
    phone: result.rows[0].phone ?? null,
    hasPassword: Boolean(result.rows[0].hasPassword)
  };
};

const ensureDevSeed = (() => {
  let promise: Promise<void> | null = null;

  return async () => {
    if (config.isProduction) {
      return;
    }

    if (promise) {
      return promise;
    }

    promise = (async () => {
      const currentPool = getPool();
      await currentPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT");
      await currentPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT");
      await currentPool.query("ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS api_key_fingerprint TEXT");
      await currentPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_credentials_owner_key
        ON provider_credentials (owner_user_id, provider_type, COALESCE(base_url, ''), api_key_fingerprint)
        WHERE api_key_fingerprint IS NOT NULL AND api_key_fingerprint <> ''
      `);
      await currentPool.query(`
        CREATE TABLE IF NOT EXISTS user_passwords (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          password_hash TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await currentPool.query(`
        CREATE TABLE IF NOT EXISTS chat_conversations (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          logical_model TEXT NOT NULL,
          title TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await currentPool.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          request_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await currentPool.query(`
        INSERT INTO users (id, display_name, role, handle, status, created_at) VALUES
          ('user_demo', 'Demo Consumer', 'user', 'demo-consumer', 'active', NOW()),
          ('admin_demo', 'Demo Admin', 'admin', 'admin-demo', 'active', NOW()),
          ('supplier_openai_demo', 'OpenAI Supplier', 'user', 'openai-supplier', 'active', NOW()),
          ('supplier_anthropic_demo', 'Anthropic Supplier', 'user', 'anthropic-supplier', 'active', NOW())
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, handle = EXCLUDED.handle, status = EXCLUDED.status
      `);
      await currentPool.query(`
        UPDATE users
        SET avatar_url = COALESCE(avatar_url, $1)
        WHERE id IN ('user_demo', 'admin_demo', 'supplier_openai_demo', 'supplier_anthropic_demo')
      `, [DEFAULT_AVATAR_URL]);

      await currentPool.query(`
        INSERT INTO user_identities (user_id, email, email_verified, created_at) VALUES
          ('user_demo', 'user_demo@xllmapi.local', TRUE, NOW()),
          ('admin_demo', 'admin_demo@xllmapi.local', TRUE, NOW()),
          ('supplier_openai_demo', 'supplier_openai_demo@xllmapi.local', TRUE, NOW()),
          ('supplier_anthropic_demo', 'supplier_anthropic_demo@xllmapi.local', TRUE, NOW())
        ON CONFLICT (user_id) DO NOTHING
      `);

      await currentPool.query(`
        INSERT INTO wallets (user_id, available_token_credit) VALUES
          ('user_demo', ${DEFAULT_INITIAL_TOKEN_CREDIT}),
          ('admin_demo', ${DEFAULT_INITIAL_TOKEN_CREDIT}),
          ('supplier_openai_demo', ${DEFAULT_INITIAL_TOKEN_CREDIT}),
          ('supplier_anthropic_demo', ${DEFAULT_INITIAL_TOKEN_CREDIT})
        ON CONFLICT (user_id) DO UPDATE SET available_token_credit = EXCLUDED.available_token_credit
      `);

      await currentPool.query(`
        INSERT INTO platform_api_keys (id, user_id, label, hashed_key, status) VALUES
          ('pak_demo_user', 'user_demo', 'Local Demo Key', $1, 'active'),
          ('pak_demo_admin', 'admin_demo', 'Local Admin Key', $2, 'active')
        ON CONFLICT (id) DO NOTHING
      `, [hashApiKey(DEV_USER_API_KEY), hashApiKey(DEV_ADMIN_API_KEY)]);
      await currentPool.query(`
        INSERT INTO user_passwords (user_id, password_hash, updated_at)
        VALUES
          ('admin_demo', $1, NOW()),
          ('user_demo', $2, NOW())
        ON CONFLICT (user_id) DO NOTHING
      `, [hashPassword("admin123456"), hashPassword("user123456")]);

      await currentPool.query(`
        INSERT INTO provider_credentials (id, owner_user_id, provider_type, base_url, encrypted_secret, api_key_env_name, status) VALUES
          ('cred_openai_demo', 'supplier_openai_demo', 'openai', 'https://api.openai.com/v1', NULL, 'OPENAI_API_KEY', 'active'),
          ('cred_anthropic_demo', 'supplier_anthropic_demo', 'anthropic', 'https://api.anthropic.com/v1', NULL, 'ANTHROPIC_API_KEY', 'active')
        ON CONFLICT (id) DO NOTHING
      `);

      await currentPool.query(`
        INSERT INTO offerings (
          id, owner_user_id, logical_model, credential_id, real_model, pricing_mode,
          fixed_price_per_1k_input, fixed_price_per_1k_output, enabled, review_status
        ) VALUES
          ('offering_openai_demo', 'supplier_openai_demo', 'gpt-4o-mini', 'cred_openai_demo', 'gpt-4o-mini', 'fixed_price', 1000, 2000, TRUE, 'approved'),
          ('offering_anthropic_demo', 'supplier_anthropic_demo', 'claude-sonnet-4-20250514', 'cred_anthropic_demo', 'claude-sonnet-4-20250514', 'fixed_price', 1500, 3000, TRUE, 'approved')
        ON CONFLICT (id) DO NOTHING
      `);

      if (DEEPSEEK_API_KEY) {
        await currentPool.query(`
          INSERT INTO users (id, display_name, role, handle, status, created_at)
          VALUES ('supplier_deepseek_demo', 'DeepSeek Supplier', 'user', 'deepseek-supplier', 'active', NOW())
          ON CONFLICT (id) DO UPDATE SET handle = EXCLUDED.handle, status = EXCLUDED.status
        `);
        await currentPool.query(`
          INSERT INTO user_identities (user_id, email, email_verified, created_at)
          VALUES ('supplier_deepseek_demo', 'supplier_deepseek_demo@xllmapi.local', TRUE, NOW())
          ON CONFLICT (user_id) DO NOTHING
        `);
        await currentPool.query(`
          INSERT INTO wallets (user_id, available_token_credit)
          VALUES ('supplier_deepseek_demo', $1)
          ON CONFLICT (user_id) DO UPDATE SET available_token_credit = EXCLUDED.available_token_credit
        `, [DEFAULT_INITIAL_TOKEN_CREDIT]);
        await currentPool.query(`
          INSERT INTO provider_credentials (
            id, owner_user_id, provider_type, base_url, encrypted_secret, api_key_env_name, status
          ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
          ON CONFLICT (id) DO UPDATE SET
            provider_type = EXCLUDED.provider_type,
            base_url = EXCLUDED.base_url,
            encrypted_secret = EXCLUDED.encrypted_secret,
            api_key_env_name = EXCLUDED.api_key_env_name,
            status = EXCLUDED.status
        `, [
          "cred_deepseek_demo",
          "supplier_deepseek_demo",
          "openai_compatible",
          "https://api.deepseek.com",
          encryptSecret(DEEPSEEK_API_KEY),
          ""
        ]);
        await currentPool.query(`
          INSERT INTO offerings (
            id, owner_user_id, logical_model, credential_id, real_model, pricing_mode,
            fixed_price_per_1k_input, fixed_price_per_1k_output, enabled, review_status
          ) VALUES ($1, $2, $3, $4, $5, 'fixed_price', $6, $7, TRUE, 'approved')
          ON CONFLICT (id) DO UPDATE SET
            owner_user_id = EXCLUDED.owner_user_id,
            logical_model = EXCLUDED.logical_model,
            credential_id = EXCLUDED.credential_id,
            real_model = EXCLUDED.real_model,
            pricing_mode = EXCLUDED.pricing_mode,
            fixed_price_per_1k_input = EXCLUDED.fixed_price_per_1k_input,
            fixed_price_per_1k_output = EXCLUDED.fixed_price_per_1k_output,
            enabled = EXCLUDED.enabled,
            review_status = EXCLUDED.review_status
        `, [
          "offering_deepseek_demo",
          "supplier_deepseek_demo",
          "deepseek-chat",
          "cred_deepseek_demo",
          "deepseek-chat",
          300,
          500
        ]);
      }
    })();

    return promise;
  };
})();

export const postgresPlatformRepository: PlatformRepository = {
  async authenticate(apiKey) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<{
      apiKeyId: string;
      userId: string;
      label: string;
      role: string;
    }>(`
      SELECT
        k.id AS "apiKeyId",
        k.user_id AS "userId",
        k.label,
        u.role
      FROM platform_api_keys k
      JOIN users u ON u.id = k.user_id
      WHERE k.hashed_key = $1 AND k.status = 'active'
      LIMIT 1
    `, [hashApiKey(apiKey)]);

    return result.rows[0] ?? null;
  },

  async authenticateSession(sessionToken) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<{
      sessionId: string;
      userId: string;
      role: "user" | "admin";
      email: string;
      displayName: string;
      handle: string;
    }>(`
      SELECT
        s.id AS "sessionId",
        u.id AS "userId",
        u.role,
        i.email,
        u.display_name AS "displayName",
        u.handle
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      JOIN user_identities i ON i.user_id = u.id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
      LIMIT 1
    `, [hashApiKey(sessionToken)]);

    return result.rows[0] ?? null;
  },

  async requestLoginCode(email) {
    await ensureDevSeed();
    const currentPool = getPool();
    const normalizedEmail = normalizeEmail(email);
    const identity = await currentPool.query("SELECT user_id FROM user_identities WHERE email = $1 LIMIT 1", [normalizedEmail]);
    const invitation = await currentPool.query(
      "SELECT id FROM invitations WHERE invited_email = $1 AND status = 'pending' AND expires_at > NOW() LIMIT 1",
      [normalizedEmail]
    );

    if (!identity.rows[0] && !invitation.rows[0]) {
      return { eligible: false, firstLogin: false };
    }

    const code = generateCode();
    await currentPool.query(`
      INSERT INTO login_codes (id, email, code_hash, expires_at, created_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes', NOW())
    `, [`lc_${randomUUID()}`, normalizedEmail, hashApiKey(code)]);

    return {
      eligible: true,
      firstLogin: !identity.rows[0],
      code: config.isProduction ? undefined : code
    };
  },

  async verifyLoginCode(email, code) {
    await ensureDevSeed();
    const currentPool = getPool();
    const normalizedEmail = normalizeEmail(email);
    const client = await currentPool.connect();
    try {
      await client.query("BEGIN");
      const codeRow = await client.query<{ id: string }>(`
        SELECT id
        FROM login_codes
        WHERE email = $1
          AND code_hash = $2
          AND consumed_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `, [normalizedEmail, hashApiKey(code)]);

      if (!codeRow.rows[0]) {
        await client.query("ROLLBACK");
        return { ok: false as const, code: "invalid_code", message: "invalid or expired verification code" };
      }

      await client.query("UPDATE login_codes SET consumed_at = NOW() WHERE id = $1", [codeRow.rows[0].id]);

      let identity = await client.query<{ userId: string }>(
        "SELECT user_id AS \"userId\" FROM user_identities WHERE email = $1 LIMIT 1",
        [normalizedEmail]
      );
      let firstLoginCompleted = false;
      let userId = identity.rows[0]?.userId ?? null;
      let initialApiKey: string | null = null;

      if (!userId) {
        const invitation = await client.query<{ id: string }>(
          "SELECT id FROM invitations WHERE invited_email = $1 AND status = 'pending' AND expires_at > NOW() LIMIT 1",
          [normalizedEmail]
        );
        if (!invitation.rows[0]) {
          await client.query("ROLLBACK");
          return { ok: false as const, code: "invite_required", message: "email has not been invited" };
        }

        userId = `user_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
        const handle = `u-${userId.slice(-8)}`;
        await client.query(`
          INSERT INTO users (id, display_name, role, handle, status, avatar_url, created_at, last_login_at)
          VALUES ($1, $2, 'user', $3, 'active', $4, NOW(), NOW())
        `, [userId, normalizedEmail.split("@")[0], handle, DEFAULT_AVATAR_URL]);
        await client.query(`
          INSERT INTO user_identities (user_id, email, email_verified, created_at, last_login_at)
          VALUES ($1, $2, TRUE, NOW(), NOW())
        `, [userId, normalizedEmail]);
        await client.query(`
          INSERT INTO wallets (user_id, available_token_credit)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO NOTHING
        `, [userId, DEFAULT_INITIAL_TOKEN_CREDIT]);
        const rawKey = `xllm_${randomUUID().replaceAll("-", "")}`;
        await client.query(`
          INSERT INTO platform_api_keys (id, user_id, label, hashed_key, status)
          VALUES ($1, $2, 'Initial API Key', $3, 'active')
        `, [`pak_${randomUUID()}`, userId, hashApiKey(rawKey)]);
        initialApiKey = rawKey;
        await client.query(`
          UPDATE invitations
          SET status = 'accepted', accepted_user_id = $1, accepted_at = NOW()
          WHERE id = $2
        `, [userId, invitation.rows[0].id]);
        // Auto-add all approved offerings to the new user's usage list
        await client.query(`
          INSERT INTO offering_favorites (user_id, offering_id, created_at)
          SELECT $1, id, NOW() FROM offerings
          WHERE enabled = true AND review_status = 'approved'
          ON CONFLICT DO NOTHING
        `, [userId]);
        firstLoginCompleted = true;
      } else {
        await client.query("UPDATE user_identities SET last_login_at = NOW() WHERE user_id = $1", [userId]);
        await client.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [userId]);
      }

      const sessionToken = `sess_${randomUUID().replaceAll("-", "")}`;
      await client.query(`
        INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
        VALUES ($1, $2, $3, NOW() + INTERVAL '30 days', NOW())
      `, [`sessrow_${randomUUID()}`, userId, hashApiKey(sessionToken)]);

      await client.query("COMMIT");
      const me = await getMeProfile(userId);

      return {
        ok: true as const,
        token: sessionToken,
        user: me as MeProfile,
        firstLoginCompleted,
        initialApiKey
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async loginWithPassword(email, password) {
    await ensureDevSeed();
    const currentPool = getPool();
    const normalizedEmail = normalizeEmail(email);
    const result = await currentPool.query<{
      userId: string;
      passwordHash: string;
    }>(`
      SELECT i.user_id AS "userId", p.password_hash AS "passwordHash"
      FROM user_identities i
      JOIN user_passwords p ON p.user_id = i.user_id
      WHERE i.email = $1
      LIMIT 1
    `, [normalizedEmail]);

    const row = result.rows[0];
    if (!row || row.passwordHash !== hashPassword(password)) {
      return { ok: false as const, code: "invalid_credentials", message: "invalid email or password" };
    }

    const sessionToken = `sess_${randomUUID().replaceAll("-", "")}`;
    await currentPool.query(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '30 days', NOW())
    `, [`sessrow_${randomUUID()}`, row.userId, hashApiKey(sessionToken)]);
    await currentPool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [row.userId]);
    await currentPool.query("UPDATE user_identities SET last_login_at = NOW() WHERE user_id = $1", [row.userId]);

    return {
      ok: true as const,
      token: sessionToken,
      user: await getMeProfile(row.userId) as MeProfile,
      firstLoginCompleted: false,
      initialApiKey: null
    };
  },

  async updateMeProfile(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      UPDATE users
      SET display_name = COALESCE($1, display_name),
          avatar_url = COALESCE($2, avatar_url)
      WHERE id = $3
    `, [params.displayName?.trim() || null, params.avatarUrl?.trim() || null, params.userId]);
    return getMeProfile(params.userId);
  },

  async updateMePassword(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const current = await currentPool.query<{ passwordHash: string }>(
      "SELECT password_hash AS \"passwordHash\" FROM user_passwords WHERE user_id = $1 LIMIT 1",
      [params.userId]
    );
    if (!current.rows[0] || current.rows[0].passwordHash !== hashPassword(params.currentPassword)) {
      return { ok: false as const, code: "invalid_password", message: "current password is invalid" };
    }
    await currentPool.query(`
      INSERT INTO user_passwords (user_id, password_hash, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        updated_at = EXCLUDED.updated_at
    `, [params.userId, hashPassword(params.newPassword)]);
    return { ok: true as const };
  },

  async updateMeEmail(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const normalizedEmail = normalizeEmail(params.newEmail);
    const existing = await currentPool.query<{ userId: string }>(
      "SELECT user_id AS \"userId\" FROM user_identities WHERE email = $1 LIMIT 1",
      [normalizedEmail]
    );
    if (existing.rows[0] && existing.rows[0].userId !== params.userId) {
      return { ok: false as const, code: "email_taken", message: "email already in use" };
    }
    await currentPool.query(
      "UPDATE user_identities SET email = $1, email_verified = TRUE WHERE user_id = $2",
      [normalizedEmail, params.userId]
    );
    return { ok: true as const, data: await getMeProfile(params.userId) };
  },

  async updateMePhone(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query("UPDATE users SET phone = $1 WHERE id = $2", [params.phone.trim(), params.userId]);
    return { ok: true as const, data: await getMeProfile(params.userId) };
  },

  async getMe(userId) {
    await ensureDevSeed();
    return getMeProfile(userId);
  },

  async listInvitations(userId) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        id,
        inviter_user_id AS "inviterUserId",
        invited_email AS "invitedEmail",
        status,
        note,
        accepted_user_id AS "acceptedUserId",
        expires_at AS "expiresAt",
        accepted_at AS "acceptedAt",
        revoked_at AS "revokedAt",
        created_at AS "createdAt"
      FROM invitations
      WHERE inviter_user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    return result.rows;
  },

  async getInvitationStats(userId) {
    await ensureDevSeed();
    const currentPool = getPool();
    const [userResult, usedResult] = await Promise.all([
      currentPool.query<{ role: string }>("SELECT role FROM users WHERE id = $1 LIMIT 1", [userId]),
      currentPool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM invitations WHERE inviter_user_id = $1", [userId])
    ]);
    const used = Number(usedResult.rows[0]?.count ?? 0);
    if (userResult.rows[0]?.role === "admin") {
      return { limit: null, used, remaining: null, unlimited: true } satisfies InvitationStats;
    }
    return { limit: 10, used, remaining: Math.max(0, 10 - used), unlimited: false } satisfies InvitationStats;
  },

  async createInvitation(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const normalizedEmail = normalizeEmail(params.invitedEmail);
    const identity = await currentPool.query("SELECT user_id FROM user_identities WHERE email = $1 LIMIT 1", [normalizedEmail]);
    if (identity.rows[0]) {
      return { ok: false as const, code: "already_registered", message: "email is already registered" };
    }
    const existing = await currentPool.query(
      "SELECT id FROM invitations WHERE invited_email = $1 AND status = 'pending' AND expires_at > NOW() LIMIT 1",
      [normalizedEmail]
    );
    if (existing.rows[0]) {
      return { ok: false as const, code: "already_invited", message: "email already has a pending invitation" };
    }
    const stats = await this.getInvitationStats(params.inviterUserId);
    if (!stats.unlimited && (stats.remaining ?? 0) <= 0) {
      return { ok: false as const, code: "invite_limit_reached", message: "invitation limit reached" };
    }
    const id = `invite_${randomUUID()}`;
    await currentPool.query(`
      INSERT INTO invitations (
        id, inviter_user_id, invited_email, status, note, expires_at, created_at
      ) VALUES ($1, $2, $3, 'pending', $4, NOW() + INTERVAL '14 days', NOW())
    `, [id, params.inviterUserId, normalizedEmail, params.note ?? null]);
    const invitation = await currentPool.query("SELECT * FROM invitations WHERE id = $1 LIMIT 1", [id]);
    return { ok: true as const, data: invitation.rows[0] };
  },

  async revokeInvitation(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const invitation = await currentPool.query<{ inviterUserId: string; status: string }>(`
      SELECT inviter_user_id AS "inviterUserId", status
      FROM invitations
      WHERE id = $1
      LIMIT 1
    `, [params.invitationId]);
    const row = invitation.rows[0];
    if (!row) {
      return { ok: false as const, code: "not_found", message: "invitation not found" };
    }
    if (!params.isAdmin && row.inviterUserId !== params.actorUserId) {
      return { ok: false as const, code: "forbidden", message: "invitation does not belong to current user" };
    }
    if (row.status !== "pending") {
      return { ok: false as const, code: "invalid_state", message: "only pending invitations can be revoked" };
    }
    await currentPool.query("UPDATE invitations SET status = 'revoked', revoked_at = NOW() WHERE id = $1", [params.invitationId]);
    return { ok: true as const };
  },

  async listAdminInvitations() {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        i.id,
        i.invited_email AS "invitedEmail",
        i.status,
        i.note,
        i.expires_at AS "expiresAt",
        i.accepted_at AS "acceptedAt",
        i.created_at AS "createdAt",
        u.display_name AS "inviterDisplayName",
        u.handle AS "inviterHandle"
      FROM invitations i
      JOIN users u ON u.id = i.inviter_user_id
      ORDER BY i.created_at DESC
    `);
    return result.rows;
  },

  async listAdminUsers() {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        u.id,
        u.display_name AS "displayName",
        u.handle,
        u.role,
        u.status,
        i.email,
        COALESCE(w.available_token_credit, 0) AS "balance",
        u.created_at AS "createdAt",
        u.last_login_at AS "lastLoginAt"
      FROM users u
      LEFT JOIN user_identities i ON i.user_id = u.id
      LEFT JOIN wallets w ON w.user_id = u.id
      ORDER BY u.created_at DESC
    `);
    return result.rows;
  },

  async createAdminInvitation(params) {
    return this.createInvitation(params);
  },

  async getWallet(userId) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<{ balance: number }>(
      "SELECT available_token_credit AS balance FROM wallets WHERE user_id = $1 LIMIT 1",
      [userId]
    );
    return Number(result.rows[0]?.balance ?? 0);
  },

  async listModels() {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<{
      name: string;
      offeringCount: string;
      enabledOfferingCount: string;
      credentialCount: string;
      ownerCount: string;
      owners: string[] | null;
      minInputPricePer1k: number | null;
      minOutputPricePer1k: number | null;
      providers: string[] | null;
      pricingModes: string[] | null;
    }>(`
      SELECT
        o.logical_model AS name,
        COUNT(*)::text AS "offeringCount",
        SUM(CASE WHEN o.enabled THEN 1 ELSE 0 END)::text AS "enabledOfferingCount",
        COUNT(DISTINCT o.credential_id)::text AS "credentialCount",
        COUNT(DISTINCT o.owner_user_id)::text AS "ownerCount",
        ARRAY_AGG(DISTINCT o.owner_user_id) AS owners,
        MIN(o.fixed_price_per_1k_input) AS "minInputPricePer1k",
        MIN(o.fixed_price_per_1k_output) AS "minOutputPricePer1k",
        ARRAY_AGG(DISTINCT c.provider_type) AS providers,
        ARRAY_AGG(DISTINCT o.pricing_mode) AS "pricingModes"
      FROM offerings o
      JOIN provider_credentials c ON c.id = o.credential_id
      WHERE o.enabled = TRUE
        AND o.review_status = 'approved'
        AND c.status = 'active'
        AND o.owner_user_id NOT LIKE '%_demo'
      GROUP BY o.logical_model
      ORDER BY o.logical_model ASC
    `);

    const models: PublicMarketModel[] = [];
    for (const row of result.rows) {
      const featuredSuppliers: Array<{ handle: string; displayName: string }> = [];
      for (const ownerId of (row.owners ?? []).slice(0, 3)) {
        const supplier = await currentPool.query<{ handle: string; displayName: string }>(
          `SELECT handle, display_name AS "displayName" FROM users WHERE id = $1 LIMIT 1`,
          [ownerId]
        );
        if (supplier.rows[0]) {
          featuredSuppliers.push(supplier.rows[0]);
        }
      }

      models.push({
        logicalModel: row.name,
        providers: row.providers ?? [],
        providerCount: (row.providers ?? []).length,
        ownerCount: Number(row.ownerCount),
        enabledOfferingCount: Number(row.enabledOfferingCount),
        credentialCount: Number(row.credentialCount),
        pricingModes: ((row.pricingModes ?? []) as PricingMode[]),
        minInputPrice: row.minInputPricePer1k === null ? null : Number(row.minInputPricePer1k),
        minOutputPrice: row.minOutputPricePer1k === null ? null : Number(row.minOutputPricePer1k),
        status: Number(row.enabledOfferingCount) > 0 ? "available" : "limited",
        capabilities: ["chat"],
        compatibilities: ["openai", "anthropic"],
        featuredSuppliers
      });
    }

    return models;
  },

  async listMarketModels() {
    return this.listModels();
  },

  async getPublicSupplierProfile(handle) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<{
      handle: string;
      displayName: string;
      status: string;
      activeOfferingCount: string;
      servedUserCount: string;
      totalRequestCount: string;
      totalSupplyTokens: string;
      firstApprovedAt: string | null;
      lastActiveAt: string | null;
    }>(`
      SELECT
        u.handle,
        u.display_name AS "displayName",
        u.status,
        COUNT(DISTINCT CASE WHEN o.enabled = TRUE AND o.review_status = 'approved' AND c.status = 'active' THEN o.id END)::text AS "activeOfferingCount",
        COUNT(DISTINCT ar.requester_user_id)::text AS "servedUserCount",
        COUNT(ar.id)::text AS "totalRequestCount",
        COALESCE(SUM(ar.total_tokens), 0)::text AS "totalSupplyTokens",
        MIN(CASE WHEN o.enabled = TRUE AND o.review_status = 'approved' THEN o.created_at END)::text AS "firstApprovedAt",
        MAX(ar.created_at)::text AS "lastActiveAt"
      FROM users u
      LEFT JOIN offerings o ON o.owner_user_id = u.id
      LEFT JOIN provider_credentials c ON c.id = o.credential_id
      LEFT JOIN api_requests ar ON ar.chosen_offering_id = o.id
      WHERE u.handle = $1
      GROUP BY u.id, u.handle, u.display_name, u.status
      LIMIT 1
    `, [handle]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      handle: row.handle,
      displayName: row.displayName,
      status: row.status === "active" ? "active" : "inactive",
      activeOfferingCount: Number(row.activeOfferingCount),
      servedUserCount: Number(row.servedUserCount),
      totalRequestCount: Number(row.totalRequestCount),
      totalSupplyTokens: Number(row.totalSupplyTokens),
      totalStableSeconds: row.firstApprovedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(row.firstApprovedAt)) / 1000)) : 0,
      lastActiveAt: row.lastActiveAt
    } satisfies PublicSupplierProfile;
  },

  async getPublicSupplierOfferings(handle) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<{
      id: string;
      logicalModel: string;
      realModel: string;
      providerType: "openai_compatible" | "anthropic" | "openai";
      inputPricePer1k: number;
      outputPricePer1k: number;
      servedUserCount: string;
      requestCount: string;
      totalSupplyTokens: string;
      createdAt: string;
      enabled: boolean;
    }>(`
      SELECT
        o.id,
        o.logical_model AS "logicalModel",
        o.real_model AS "realModel",
        c.provider_type AS "providerType",
        o.fixed_price_per_1k_input AS "inputPricePer1k",
        o.fixed_price_per_1k_output AS "outputPricePer1k",
        COUNT(DISTINCT ar.requester_user_id)::text AS "servedUserCount",
        COUNT(ar.id)::text AS "requestCount",
        COALESCE(SUM(ar.total_tokens), 0)::text AS "totalSupplyTokens",
        o.created_at::text AS "createdAt",
        o.enabled
      FROM offerings o
      JOIN users u ON u.id = o.owner_user_id
      JOIN provider_credentials c ON c.id = o.credential_id
      LEFT JOIN api_requests ar ON ar.chosen_offering_id = o.id
      WHERE u.handle = $1
        AND o.enabled = TRUE
        AND o.review_status = 'approved'
        AND c.status = 'active'
      GROUP BY o.id, o.logical_model, o.real_model, c.provider_type, o.fixed_price_per_1k_input,
        o.fixed_price_per_1k_output, o.created_at, o.enabled
      ORDER BY o.logical_model ASC
    `, [handle]);
    return result.rows.map((row) => ({
      id: row.id,
      logicalModel: row.logicalModel,
      realModel: row.realModel,
      providerType: row.providerType,
      compatibilities: ["openai", "anthropic"],
      inputPricePer1k: Number(row.inputPricePer1k),
      outputPricePer1k: Number(row.outputPricePer1k),
      servedUserCount: Number(row.servedUserCount),
      requestCount: Number(row.requestCount),
      totalSupplyTokens: Number(row.totalSupplyTokens),
      stableSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(row.createdAt)) / 1000)),
      enabled: row.enabled
    })) satisfies PublicSupplierOffering[];
  },

  async getSupplyUsage(userId) {
    await ensureDevSeed();
    const currentPool = getPool();
    const [summary, items] = await Promise.all([
      currentPool.query(`
        SELECT
          COUNT(ar.id)::text AS "requestCount",
          COALESCE(SUM(ar.input_tokens), 0)::text AS "inputTokens",
          COALESCE(SUM(ar.output_tokens), 0)::text AS "outputTokens",
          COALESCE(SUM(ar.total_tokens), 0)::text AS "totalTokens",
          COALESCE(SUM(sr.supplier_reward), 0)::text AS "supplierReward"
        FROM offerings o
        LEFT JOIN api_requests ar ON ar.chosen_offering_id = o.id
        LEFT JOIN settlement_records sr ON sr.request_id = ar.id
        WHERE o.owner_user_id = $1
      `, [userId]),
      currentPool.query(`
        SELECT
          o.id AS "offeringId",
          o.logical_model AS "logicalModel",
          o.real_model AS "realModel",
          COUNT(ar.id)::text AS "requestCount",
          COALESCE(SUM(ar.input_tokens), 0)::text AS "inputTokens",
          COALESCE(SUM(ar.output_tokens), 0)::text AS "outputTokens",
          COALESCE(SUM(ar.total_tokens), 0)::text AS "totalTokens",
          COALESCE(SUM(sr.supplier_reward), 0)::text AS "supplierReward"
        FROM offerings o
        LEFT JOIN api_requests ar ON ar.chosen_offering_id = o.id
        LEFT JOIN settlement_records sr ON sr.request_id = ar.id
        WHERE o.owner_user_id = $1
        GROUP BY o.id, o.logical_model, o.real_model
        ORDER BY COALESCE(SUM(ar.total_tokens), 0) DESC, o.logical_model ASC
      `, [userId])
    ]);
    return { summary: summary.rows[0], items: items.rows };
  },

  async getConsumptionUsage(userId) {
    await ensureDevSeed();
    const currentPool = getPool();
    const [summary, items] = await Promise.all([
      currentPool.query(`
        SELECT
          COUNT(ar.id)::text AS "requestCount",
          COALESCE(SUM(ar.input_tokens), 0)::text AS "inputTokens",
          COALESCE(SUM(ar.output_tokens), 0)::text AS "outputTokens",
          COALESCE(SUM(ar.total_tokens), 0)::text AS "totalTokens",
          COALESCE(SUM(sr.consumer_cost), 0)::text AS "consumerCost"
        FROM api_requests ar
        LEFT JOIN settlement_records sr ON sr.request_id = ar.id
        WHERE ar.requester_user_id = $1
      `, [userId]),
      currentPool.query(`
        SELECT
          logical_model AS "logicalModel",
          COUNT(id)::text AS "requestCount",
          COALESCE(SUM(input_tokens), 0)::text AS "inputTokens",
          COALESCE(SUM(output_tokens), 0)::text AS "outputTokens",
          COALESCE(SUM(total_tokens), 0)::text AS "totalTokens",
          MAX(created_at)::text AS "lastUsedAt"
        FROM api_requests
        WHERE requester_user_id = $1
        GROUP BY logical_model
        ORDER BY COALESCE(SUM(total_tokens), 0) DESC, logical_model ASC
      `, [userId])
    ]);
    return { summary: summary.rows[0], items: items.rows };
  },

  async getConsumptionDaily(userId, year) {
    await ensureDevSeed();
    const currentPool = getPool();
    const startDate = `${year}-01-01`;
    const endDate = `${year + 1}-01-01`;
    const result = await currentPool.query(`
      SELECT
        SUBSTRING(created_at::text FROM 1 FOR 10) AS "date",
        COALESCE(SUM(total_tokens), 0)::text AS "totalTokens",
        COUNT(id)::text AS "requestCount"
      FROM api_requests
      WHERE requester_user_id = $1
        AND created_at >= $2 AND created_at < $3
      GROUP BY SUBSTRING(created_at::text FROM 1 FOR 10)
      ORDER BY "date" ASC
    `, [userId, startDate, endDate]);
    return result.rows;
  },

  async getConsumptionByDate(userId, date) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        logical_model AS "logicalModel",
        COUNT(id)::text AS "requestCount",
        COALESCE(SUM(input_tokens), 0)::text AS "inputTokens",
        COALESCE(SUM(output_tokens), 0)::text AS "outputTokens",
        COALESCE(SUM(total_tokens), 0)::text AS "totalTokens"
      FROM api_requests
      WHERE requester_user_id = $1
        AND SUBSTRING(created_at::text FROM 1 FOR 10) = $2
      GROUP BY logical_model
      ORDER BY COALESCE(SUM(total_tokens), 0) DESC
    `, [userId, date]);
    return result.rows;
  },

  async getConsumptionRecent(userId, days = 30, limit = 500) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        id AS "requestId",
        logical_model AS "logicalModel",
        provider,
        real_model AS "realModel",
        LEAST(input_tokens, 2147483647)::text AS "inputTokens",
        LEAST(output_tokens, 2147483647)::text AS "outputTokens",
        LEAST(total_tokens, 2147483647)::text AS "totalTokens",
        created_at::text AS "createdAt"
      FROM api_requests
      WHERE requester_user_id = $1
        AND created_at >= (NOW() - ($2 || ' days')::interval)
      ORDER BY created_at DESC
      LIMIT $3
    `, [userId, days, limit]);
    return result.rows;
  },

  async getSupplyRecent(userId: string, days = 30, limit = 500) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        ar.id AS "requestId",
        ar.logical_model AS "logicalModel",
        ar.provider,
        ar.real_model AS "realModel",
        LEAST(ar.input_tokens, 2147483647)::text AS "inputTokens",
        LEAST(ar.output_tokens, 2147483647)::text AS "outputTokens",
        LEAST(ar.total_tokens, 2147483647)::text AS "totalTokens",
        ar.created_at::text AS "createdAt",
        COALESCE(sr.supplier_reward, 0)::text AS "supplierReward"
      FROM api_requests ar
      JOIN offerings o ON o.id = ar.chosen_offering_id
      LEFT JOIN settlement_records sr ON sr.request_id = ar.id
      WHERE o.owner_user_id = $1
        AND ar.created_at >= (NOW() - ($2 || ' days')::interval)
      ORDER BY ar.created_at DESC
      LIMIT $3
    `, [userId, days, limit]);
    return result.rows;
  },

  async getAdminUsageSummary(days?: number) {
    await ensureDevSeed();
    const currentPool = getPool();
    const whereClause = days ? `WHERE created_at > NOW() - INTERVAL '${Number(days)} days'` : "";
    const [summary, topModels, topConsumers] = await Promise.all([
      currentPool.query(`
        SELECT
          COUNT(id)::text AS "totalRequests",
          COALESCE(SUM(total_tokens), 0)::text AS "totalTokens",
          COUNT(DISTINCT requester_user_id)::text AS "consumerCount",
          COUNT(DISTINCT chosen_offering_id)::text AS "offeringCount"
        FROM api_requests
        ${whereClause}
      `),
      currentPool.query(`
        SELECT
          logical_model AS "logicalModel",
          COUNT(id)::text AS "requestCount",
          COALESCE(SUM(total_tokens), 0)::text AS "totalTokens"
        FROM api_requests
        ${whereClause}
        GROUP BY logical_model
        ORDER BY COALESCE(SUM(total_tokens), 0) DESC
        LIMIT 10
      `),
      currentPool.query(`
        SELECT
          ar.requester_user_id AS "requesterUserId",
          u.display_name AS "displayName",
          i.email,
          COUNT(ar.id)::text AS "requestCount",
          SUM(ar.total_tokens)::text AS "totalTokens"
        FROM api_requests ar
        LEFT JOIN users u ON u.id = ar.requester_user_id
        LEFT JOIN user_identities i ON i.user_id = ar.requester_user_id
        ${whereClause ? whereClause.replace("created_at", "ar.created_at") : ""}
        GROUP BY ar.requester_user_id, u.display_name, i.email
        ORDER BY SUM(ar.total_tokens) DESC
        LIMIT 10
      `)
    ]);
    return { summary: summary.rows[0], topModels: topModels.rows, topConsumers: topConsumers.rows };
  },

  async getDebugState() {
    await ensureDevSeed();
    const currentPool = getPool();
    const [apiKeys, auditLogs, wallets, offerings] = await Promise.all([
      currentPool.query("SELECT id, user_id, label, status FROM platform_api_keys ORDER BY id ASC"),
      currentPool.query("SELECT actor_user_id, action, target_type, target_id, created_at FROM audit_logs ORDER BY id DESC LIMIT 20"),
      currentPool.query("SELECT * FROM wallets ORDER BY user_id ASC"),
      currentPool.query(`
        SELECT
          o.id,
          o.logical_model,
          o.real_model,
          o.enabled,
          o.review_status,
          c.provider_type,
          CASE WHEN c.encrypted_secret IS NOT NULL AND c.encrypted_secret != '' THEN TRUE ELSE FALSE END AS has_encrypted_secret,
          c.api_key_env_name
        FROM offerings o
        JOIN provider_credentials c ON c.id = o.credential_id
        ORDER BY o.id ASC
      `)
    ]);

    return {
      apiKeys: apiKeys.rows,
      auditLogs: auditLogs.rows,
      wallets: wallets.rows,
      offerings: offerings.rows
    };
  },

  async writeAuditLog(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `, [
      params.actorUserId,
      params.action,
      params.targetType,
      params.targetId,
      JSON.stringify(params.payload ?? {})
    ]);
  },

  async findOfferingForModel(logicalModel) {
    const offerings = await this.findOfferingsForModel(logicalModel);
    return offerings[0] ?? null;
  },

  async findOfferingsForModel(logicalModel) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<OfferingExecutionRow>(`
      SELECT
        o.id AS "offeringId",
        o.owner_user_id AS "ownerUserId",
        c.provider_type AS "providerType",
        c.id AS "credentialId",
        c.base_url AS "baseUrl",
        c.encrypted_secret AS "encryptedSecret",
        c.api_key_env_name AS "apiKeyEnvName",
        o.real_model AS "realModel",
        o.pricing_mode AS "pricingMode",
        o.fixed_price_per_1k_input AS "fixedPricePer1kInput",
        o.fixed_price_per_1k_output AS "fixedPricePer1kOutput",
        o.review_status AS "reviewStatus",
        60 AS "qpsLimit",
        128000 AS "maxContextTokens",
        0.99 AS "successRate1h",
        1200 AS "p95LatencyMs1h",
        0.01 AS "recentErrorRate10m",
        o.enabled AS enabled,
        o.logical_model AS "logicalModel"
      FROM offerings o
      JOIN provider_credentials c ON c.id = o.credential_id
      WHERE o.logical_model = $1 AND o.enabled = TRUE AND o.review_status = 'approved' AND c.status = 'active'
      ORDER BY o.id ASC
    `, [logicalModel]);

    return result.rows;
  },

  async findUserOfferingsForModel(params: { userId: string; logicalModel: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        o.id AS "offeringId",
        o.owner_user_id AS "ownerUserId",
        o.logical_model AS "logicalModel",
        o.real_model AS "realModel",
        o.pricing_mode AS "pricingMode",
        o.fixed_price_per_1k_input AS "fixedPricePer1kInput",
        o.fixed_price_per_1k_output AS "fixedPricePer1kOutput",
        o.execution_mode AS "executionMode",
        o.node_id AS "nodeId",
        o.enabled,
        c.provider_type AS "providerType",
        c.encrypted_secret AS "encryptedSecret",
        c.api_key_env_name AS "apiKeyEnvName",
        c.base_url AS "baseUrl"
      FROM offerings o
      JOIN offering_favorites f ON f.offering_id = o.id AND f.user_id = $1
      LEFT JOIN provider_credentials c ON c.id = o.credential_id
      WHERE o.logical_model = $2
        AND o.enabled = true
        AND o.review_status = 'approved'
    `, [params.userId, params.logicalModel]);
    return result.rows;
  },

  async listProviderCredentials(userId) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<ProviderCredentialRow>(`
      SELECT
        id,
        owner_user_id AS "ownerUserId",
        provider_type AS "providerType",
        base_url AS "baseUrl",
        CASE WHEN encrypted_secret IS NOT NULL AND encrypted_secret != '' THEN TRUE ELSE FALSE END AS "hasEncryptedSecret",
        api_key_env_name AS "apiKeyEnvName",
        status
      FROM provider_credentials
      WHERE owner_user_id = $1
      ORDER BY id ASC
    `, [userId]);

    return result.rows;
  },

  async getProviderCredential(userId, credentialId) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<ProviderCredentialRow>(`
      SELECT
        id,
        owner_user_id AS "ownerUserId",
        provider_type AS "providerType",
        base_url AS "baseUrl",
        CASE WHEN encrypted_secret IS NOT NULL AND encrypted_secret != '' THEN TRUE ELSE FALSE END AS "hasEncryptedSecret",
        api_key_env_name AS "apiKeyEnvName",
        status
      FROM provider_credentials
      WHERE owner_user_id = $1 AND id = $2
      LIMIT 1
    `, [userId, credentialId]);
    return result.rows[0] ?? null;
  },

  async createProviderCredential(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const normalizedBaseUrl = normalizeBaseUrl(params.baseUrl);
    const fingerprint = providerKeyFingerprint({
      providerType: params.providerType,
      baseUrl: normalizedBaseUrl,
      apiKey: params.apiKey
    });
    const existing = await currentPool.query<{ id: string }>(`
      SELECT id
      FROM provider_credentials
      WHERE owner_user_id = $1
        AND provider_type = $2
        AND COALESCE(base_url, '') = COALESCE($3, '')
        AND api_key_fingerprint = $4
      LIMIT 1
    `, [params.ownerUserId, params.providerType, normalizedBaseUrl, fingerprint]);
    if (existing.rows[0]) {
      return {
        ok: false as const,
        code: "duplicate_provider_key",
        message: "this API key is already connected"
      };
    }
    await currentPool.query(`
      INSERT INTO provider_credentials (
        id, owner_user_id, provider_type, base_url, encrypted_secret, api_key_env_name, status, api_key_fingerprint
      ) VALUES ($1, $2, $3, $4, $5, '', 'active', $6)
    `, [
      params.id,
      params.ownerUserId,
      params.providerType,
      normalizedBaseUrl,
      encryptSecret(params.apiKey),
      fingerprint
    ]);
    return {
      ok: true as const,
      data: await this.getProviderCredential(params.ownerUserId, params.id)
    };
  },

  async updateProviderCredentialStatus(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const current = await this.getProviderCredential(params.ownerUserId, params.credentialId);
    if (!current) {
      return { ok: false, code: "not_found", message: "credential not found for current user" };
    }

    if (params.status === "disabled") {
      const linked = await currentPool.query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM offerings
        WHERE owner_user_id = $1 AND credential_id = $2 AND enabled = TRUE
      `, [params.ownerUserId, params.credentialId]);

      if (Number(linked.rows[0]?.count ?? 0) > 0) {
        return { ok: false, code: "risk_linked_enabled_offerings", message: "disable linked offerings before disabling this credential" };
      }
    }

    await currentPool.query(`
      UPDATE provider_credentials
      SET status = $1
      WHERE owner_user_id = $2 AND id = $3
    `, [params.status, params.ownerUserId, params.credentialId]);

    return { ok: true, data: await this.getProviderCredential(params.ownerUserId, params.credentialId) };
  },

  async removeProviderCredential(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const credential = await this.getProviderCredential(params.ownerUserId, params.credentialId);
    if (!credential) {
      return { ok: false, code: "not_found", message: "credential not found for current user" };
    }
    if (credential.status !== "disabled") {
      return { ok: false, code: "risk_active_credential", message: "disable credential before deleting it" };
    }
    const linked = await currentPool.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM offerings
      WHERE owner_user_id = $1 AND credential_id = $2
    `, [params.ownerUserId, params.credentialId]);
    if (Number(linked.rows[0]?.count ?? 0) > 0) {
      return { ok: false, code: "risk_linked_offerings", message: "delete linked offerings before deleting this credential" };
    }
    await currentPool.query("DELETE FROM provider_credentials WHERE owner_user_id = $1 AND id = $2", [params.ownerUserId, params.credentialId]);
    return { ok: true };
  },

  async listOfferings(userId) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<OfferingListRow>(`
      SELECT
        id,
        owner_user_id AS "ownerUserId",
        logical_model AS "logicalModel",
        credential_id AS "credentialId",
        real_model AS "realModel",
        pricing_mode AS "pricingMode",
        fixed_price_per_1k_input AS "fixedPricePer1kInput",
        fixed_price_per_1k_output AS "fixedPricePer1kOutput",
        enabled,
        review_status AS "reviewStatus",
        created_at AS "createdAt"
      FROM offerings
      WHERE owner_user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    return result.rows;
  },

  async listPendingOfferings() {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        o.id,
        o.owner_user_id AS "ownerUserId",
        o.logical_model AS "logicalModel",
        o.credential_id AS "credentialId",
        o.real_model AS "realModel",
        o.pricing_mode AS "pricingMode",
        o.fixed_price_per_1k_input AS "fixedPricePer1kInput",
        o.fixed_price_per_1k_output AS "fixedPricePer1kOutput",
        o.enabled,
        o.review_status AS "reviewStatus",
        c.provider_type AS "providerType",
        c.base_url AS "baseUrl",
        c.status AS "credentialStatus",
        i.email AS "userEmail",
        u.display_name AS "userDisplayName"
      FROM offerings o
      JOIN provider_credentials c ON c.id = o.credential_id
      LEFT JOIN users u ON u.id = o.owner_user_id
      LEFT JOIN user_identities i ON i.user_id = o.owner_user_id
      WHERE o.review_status = 'pending'
      ORDER BY o.id ASC
    `);
    return result.rows;
  },

  async createOffering(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO offerings (
        id, owner_user_id, logical_model, credential_id, real_model, pricing_mode,
        fixed_price_per_1k_input, fixed_price_per_1k_output, enabled, review_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, 'approved')
    `, [
      params.id,
      params.ownerUserId,
      params.logicalModel,
      params.credentialId,
      params.realModel,
      params.pricingMode,
      params.fixedPricePer1kInput,
      params.fixedPricePer1kOutput
    ]);
    return getOfferingById(params.ownerUserId, params.id);
  },

  async updateOffering(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const current = await getOfferingById(params.ownerUserId, params.offeringId);
    if (!current) {
      return { ok: false, code: "not_found", message: "offering not found for current user" };
    }
    if (params.enabled === true) {
      const credential = await this.getProviderCredential(params.ownerUserId, current.credentialId);
      if (!credential || credential.status !== "active") {
        return { ok: false, code: "risk_inactive_credential", message: "activate the linked credential before enabling this offering" };
      }
    }
    await currentPool.query(`
      UPDATE offerings
      SET pricing_mode = $1,
          fixed_price_per_1k_input = $2,
          fixed_price_per_1k_output = $3,
          enabled = $4
      WHERE owner_user_id = $5 AND id = $6
    `, [
      params.pricingMode ?? current.pricingMode,
      params.fixedPricePer1kInput ?? current.fixedPricePer1kInput,
      params.fixedPricePer1kOutput ?? current.fixedPricePer1kOutput,
      params.enabled === undefined ? current.enabled : Boolean(params.enabled),
      params.ownerUserId,
      params.offeringId
    ]);
    return { ok: true, data: await getOfferingById(params.ownerUserId, params.offeringId) };
  },

  async removeOffering(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const current = await getOfferingById(params.ownerUserId, params.offeringId);
    if (!current) {
      return { ok: false, code: "not_found", message: "offering not found for current user" };
    }
    if (current.enabled) {
      return { ok: false, code: "risk_active_offering", message: "disable offering before deleting it" };
    }
    const requestCount = await currentPool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM api_requests WHERE chosen_offering_id = $1",
      [params.offeringId]
    );
    if (Number(requestCount.rows[0]?.count ?? 0) > 0) {
      return { ok: false, code: "risk_historical_requests", message: "offering has historical requests and cannot be deleted" };
    }
    await currentPool.query("DELETE FROM offerings WHERE owner_user_id = $1 AND id = $2", [params.ownerUserId, params.offeringId]);
    return { ok: true };
  },

  async reviewOffering(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const existing = await currentPool.query<{ id: string }>(
      "SELECT id FROM offerings WHERE id = $1 LIMIT 1",
      [params.offeringId]
    );
    if (!existing.rows[0]) {
      return { ok: false, code: "not_found", message: "offering not found" };
    }
    await currentPool.query(`
      UPDATE offerings
      SET review_status = $1,
          enabled = CASE WHEN $1 = 'approved' THEN enabled ELSE FALSE END
      WHERE id = $2
    `, [params.reviewStatus, params.offeringId]);
    const row = await currentPool.query(`
      SELECT
        id,
        owner_user_id AS "ownerUserId",
        logical_model AS "logicalModel",
        review_status AS "reviewStatus",
        enabled
      FROM offerings
      WHERE id = $1
      LIMIT 1
    `, [params.offeringId]);
    return { ok: true, data: row.rows[0] };
  },

  async findCachedResponse(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query<{ responseBody: unknown }>(`
      SELECT response_body AS "responseBody"
      FROM api_requests
      WHERE requester_user_id = $1 AND idempotency_key = $2 AND response_body IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [params.requesterUserId, params.idempotencyKey]);
    return result.rows[0]?.responseBody ?? null;
  },

  async recordChatSettlement(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const client = await currentPool.connect();
    const inputCost = Math.ceil((params.inputTokens * params.fixedPricePer1kInput) / 1000);
    const outputCost = Math.ceil((params.outputTokens * params.fixedPricePer1kOutput) / 1000);
    const consumerCost = inputCost + outputCost;
    const supplierReward = Math.floor(consumerCost * 0.85);
    const platformMargin = consumerCost - supplierReward;

    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO wallets (user_id, available_token_credit) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [params.requesterUserId, DEFAULT_INITIAL_TOKEN_CREDIT]);
      await client.query("INSERT INTO wallets (user_id, available_token_credit) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [params.supplierUserId, DEFAULT_INITIAL_TOKEN_CREDIT]);
      await client.query(`
        INSERT INTO api_requests (
          id, requester_user_id, logical_model, chosen_offering_id, provider, real_model,
          input_tokens, output_tokens, total_tokens, status, idempotency_key, response_body
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10, $11::jsonb)
      `, [
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
        params.responseBody ? JSON.stringify(params.responseBody) : null
      ]);
      await client.query("UPDATE wallets SET available_token_credit = available_token_credit - $1 WHERE user_id = $2", [consumerCost, params.requesterUserId]);
      await client.query("UPDATE wallets SET available_token_credit = available_token_credit + $1 WHERE user_id = $2", [supplierReward, params.supplierUserId]);
      await client.query(`
        INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type)
        VALUES ($1, $2, 'debit', $3, 'consumer_cost')
      `, [params.requestId, params.requesterUserId, consumerCost]);
      await client.query(`
        INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type)
        VALUES ($1, $2, 'credit', $3, 'supplier_reward')
      `, [params.requestId, params.supplierUserId, supplierReward]);
      await client.query(`
        INSERT INTO settlement_records (
          request_id, consumer_user_id, supplier_user_id, consumer_cost, supplier_reward, platform_margin
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        params.requestId,
        params.requesterUserId,
        params.supplierUserId,
        consumerCost,
        supplierReward,
        platformMargin
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async createChatConversation(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      INSERT INTO chat_conversations (id, owner_user_id, logical_model, title, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING
        id,
        owner_user_id AS "ownerUserId",
        logical_model AS "logicalModel",
        title,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `, [params.id, params.ownerUserId, params.logicalModel, params.title ?? null]);
    return result.rows[0];
  },

  async getChatConversation(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        id,
        owner_user_id AS "ownerUserId",
        logical_model AS "logicalModel",
        title,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM chat_conversations
      WHERE owner_user_id = $1 AND id = $2
      LIMIT 1
    `, [params.ownerUserId, params.conversationId]);
    return result.rows[0] ?? null;
  },

  async listChatConversations(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const hasModel = params.logicalModel && params.logicalModel.length > 0;
    const result = await currentPool.query(`
      SELECT
        c.id,
        c.logical_model AS "logicalModel",
        c.title,
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt",
        (
          SELECT m.content
          FROM chat_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS "lastMessage"
      FROM chat_conversations c
      WHERE c.owner_user_id = $1
        ${hasModel ? "AND c.logical_model = $3" : ""}
      ORDER BY c.updated_at DESC
      LIMIT $2
    `, hasModel
      ? [params.ownerUserId, params.limit ?? 100, params.logicalModel]
      : [params.ownerUserId, params.limit ?? 100]
    );
    return result.rows;
  },

  async listChatMessages(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        m.id,
        m.conversation_id AS "conversationId",
        m.role,
        m.content,
        m.request_id AS "requestId",
        m.created_at AS "createdAt"
      FROM chat_messages m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE c.owner_user_id = $1 AND m.conversation_id = $2
      ORDER BY m.created_at ASC
      LIMIT $3
    `, [params.ownerUserId, params.conversationId, params.limit ?? 500]);
    return result.rows;
  },

  async appendChatMessage(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const client = await currentPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO chat_messages (id, conversation_id, role, content, request_id, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [params.id, params.conversationId, params.role, params.content, params.requestId ?? null]);
      await client.query("UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1", [params.conversationId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async deleteChatConversation(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    const client = await currentPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM chat_messages WHERE conversation_id = $1", [params.conversationId]);
      const result = await client.query(
        "DELETE FROM chat_conversations WHERE id = $1 AND owner_user_id = $2",
        [params.conversationId, params.ownerUserId]
      );
      await client.query("COMMIT");
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async updateChatConversationTitle(params) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(
      "UPDATE chat_conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND owner_user_id = $3",
      [params.title, params.conversationId, params.ownerUserId]
    );
    const result = await currentPool.query(`
      SELECT
        id,
        owner_user_id AS "ownerUserId",
        logical_model AS "logicalModel",
        title,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM chat_conversations
      WHERE id = $1 AND owner_user_id = $2
      LIMIT 1
    `, [params.conversationId, params.ownerUserId]);
    return result.rows[0] ?? null;
  },

  async getNetworkTrends(days: number) {
    await ensureDevSeed();
    const pool = getPool();
    const result = await pool.query(`
      SELECT
        SUBSTRING(ar.created_at::text FROM 1 FOR 10) AS day,
        ar.logical_model AS "logicalModel",
        COUNT(*)::int AS requests,
        COALESCE(SUM(ar.total_tokens), 0)::bigint AS tokens,
        COUNT(DISTINCT ar.requester_user_id)::int AS users,
        COALESCE(AVG(o.fixed_price_per_1k_input + o.fixed_price_per_1k_output), 0)::int AS "avgPrice"
      FROM api_requests ar
      LEFT JOIN offerings o ON o.id = ar.chosen_offering_id
      WHERE ar.created_at > NOW() - INTERVAL '${Math.min(Math.max(days, 1), 90)} days'
        AND ar.logical_model NOT LIKE 'community-%'
        AND ar.logical_model NOT LIKE 'e2e-%'
      GROUP BY SUBSTRING(ar.created_at::text FROM 1 FOR 10), ar.logical_model
      ORDER BY day ASC
    `);

    // Group by date
    const dateMap = new Map<string, Record<string, { requests: number; tokens: number; users: number; avgPrice: number }>>();
    for (const row of result.rows) {
      const d = String(row.day);
      if (!dateMap.has(d)) dateMap.set(d, {});
      dateMap.get(d)![row.logicalModel] = {
        requests: Number(row.requests),
        tokens: Number(row.tokens),
        users: Number(row.users),
        avgPrice: Number(row.avgPrice),
      };
    }

    return Array.from(dateMap.entries()).map(([date, models]) => ({ date, models }));
  },

  async getSupplyDaily(userId: string, year: number) {
    await ensureDevSeed();
    const pool = getPool();
    const startDate = `${year}-01-01`;
    const endDate = `${year + 1}-01-01`;
    const result = await pool.query(`
      SELECT
        SUBSTRING(ar.created_at::text FROM 1 FOR 10) AS "date",
        COALESCE(SUM(ar.total_tokens), 0)::text AS "totalTokens",
        COUNT(ar.id)::text AS "requestCount"
      FROM api_requests ar
      JOIN offerings o ON o.id = ar.chosen_offering_id
      WHERE o.owner_user_id = $1
        AND ar.created_at >= $2 AND ar.created_at < $3
      GROUP BY SUBSTRING(ar.created_at::text FROM 1 FOR 10)
      ORDER BY "date" ASC
    `, [userId, startDate, endDate]);
    return result.rows;
  },

  async getAvgSettlementPrice7d() {
    await ensureDevSeed();
    const pool = getPool();
    const result = await pool.query(`
      SELECT
        COALESCE(AVG(o.fixed_price_per_1k_input), 0) AS "avgInput",
        COALESCE(AVG(o.fixed_price_per_1k_output), 0) AS "avgOutput"
      FROM api_requests ar
      JOIN offerings o ON o.id = ar.chosen_offering_id
      WHERE ar.created_at > NOW() - INTERVAL '7 days'
        AND ar.logical_model NOT LIKE 'community-%'
        AND ar.logical_model NOT LIKE 'e2e-%'
    `);
    const row = result.rows[0];
    if (!row) return null;
    return { avgInput: Math.round(Number(row.avgInput)), avgOutput: Math.round(Number(row.avgOutput)) };
  },

  async getNetworkModelStats() {
    await ensureDevSeed();
    const pool = getPool();

    // Per-model stats from api_requests (last 30 days)
    const statsResult = await pool.query(`
      SELECT
        logical_model AS "logicalModel",
        COUNT(*) AS "totalRequests",
        SUM(total_tokens) AS "totalTokens",
        SUM(input_tokens) AS "totalInputTokens",
        SUM(output_tokens) AS "totalOutputTokens",
        COUNT(DISTINCT requester_user_id) AS "uniqueUsers"
      FROM api_requests
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND logical_model NOT LIKE 'community-%'
        AND logical_model NOT LIKE 'e2e-%'
      GROUP BY logical_model
      ORDER BY COUNT(*) DESC
    `);

    // 7-day daily trend per model
    const trendResult = await pool.query(`
      SELECT
        logical_model AS "logicalModel",
        DATE(created_at) AS day,
        COUNT(*) AS reqs
      FROM api_requests
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND logical_model NOT LIKE 'community-%'
        AND logical_model NOT LIKE 'e2e-%'
      GROUP BY logical_model, DATE(created_at)
      ORDER BY logical_model, day
    `);

    // Build trend map: model → [day0, day1, ..., day6]
    const trendMap: Record<string, number[]> = {};
    const today = new Date();
    for (const row of trendResult.rows) {
      if (!trendMap[row.logicalModel]) {
        trendMap[row.logicalModel] = new Array(7).fill(0);
      }
      const dayDate = new Date(row.day);
      const daysAgo = Math.floor((today.getTime() - dayDate.getTime()) / 86400000);
      const idx = 6 - Math.min(daysAgo, 6);
      trendMap[row.logicalModel]![idx] = Number(row.reqs);
    }

    return statsResult.rows.map((row) => ({
      logicalModel: row.logicalModel,
      totalRequests: Number(row.totalRequests),
      totalTokens: Number(row.totalTokens),
      totalInputTokens: Number(row.totalInputTokens),
      totalOutputTokens: Number(row.totalOutputTokens),
      uniqueUsers: Number(row.uniqueUsers),
      last7dTrend: trendMap[row.logicalModel] ?? new Array(7).fill(0)
    }));
  },

  async getAdminUsageRecent(limit: number) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        ar.id AS "requestId",
        ar.logical_model AS "logicalModel",
        ar.provider,
        ar.total_tokens AS "totalTokens",
        ar.created_at AS "createdAt",
        u.display_name AS "userName",
        i.email AS "userEmail"
      FROM api_requests ar
      LEFT JOIN users u ON u.id = ar.requester_user_id
      LEFT JOIN user_identities i ON i.user_id = ar.requester_user_id
      ORDER BY ar.created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  },

  async getAdminStats() {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT COUNT(DISTINCT requester_user_id) AS "activeUsers"
      FROM api_requests
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);
    return { activeUsers: Number(result.rows[0]?.activeUsers ?? 0) };
  },

  async updateAdminUser(userId: string, updates: { role?: string; status?: string; walletAdjust?: number }) {
    await ensureDevSeed();
    const currentPool = getPool();
    if (updates.role) {
      await currentPool.query("UPDATE users SET role = $2 WHERE id = $1", [userId, updates.role]);
    }
    if (updates.status) {
      await currentPool.query("UPDATE users SET status = $2 WHERE id = $1", [userId, updates.status]);
    }
    if (updates.walletAdjust != null) {
      await currentPool.query(
        "UPDATE wallets SET available_token_credit = available_token_credit + $2 WHERE user_id = $1",
        [userId, updates.walletAdjust]
      );
    }
    return { ok: true };
  },

  async getAdminProviders() {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        c.provider_type AS "providerType",
        COUNT(DISTINCT o.id)::text AS "offeringCount",
        COUNT(DISTINCT ar.id)::text AS "requestCount"
      FROM provider_credentials c
      LEFT JOIN offerings o ON o.credential_id = c.id AND o.enabled = TRUE
      LEFT JOIN api_requests ar ON ar.chosen_offering_id = o.id
      GROUP BY c.provider_type
    `);
    return result.rows;
  },

  async getAdminConfig() {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(
      "SELECT key, value, updated_at AS \"updatedAt\" FROM platform_config ORDER BY key"
    );
    return result.rows;
  },

  async updateAdminConfig(key: string, value: string, updatedBy: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(
      "UPDATE platform_config SET value = $2, updated_at = NOW(), updated_by = $3 WHERE key = $1",
      [key, value, updatedBy]
    );
    return { ok: true };
  },

  async getAdminAuditLogs(limit: number) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        al.*,
        u.display_name AS "actorName"
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.actor_user_id
      ORDER BY al.created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  },

  async createNotification(params: { id: string; title: string; body: string; type: string; targetUserId?: string | null; createdBy: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO notifications (id, title, content, type, target_user_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [params.id, params.title, params.body, params.type, params.targetUserId ?? null, params.createdBy]);
    return { id: params.id };
  },

  async listAdminNotifications() {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        n.*,
        COUNT(nr.user_id)::text AS "readCount"
      FROM notifications n
      LEFT JOIN notification_reads nr ON nr.notification_id = n.id
      GROUP BY n.id
      ORDER BY n.created_at DESC
    `);
    return result.rows;
  },

  async listUserNotifications(userId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        n.*,
        CASE WHEN nr.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS "isRead"
      FROM notifications n
      LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
      WHERE n.target_user_id IS NULL OR n.target_user_id = $1
      ORDER BY n.created_at DESC
    `, [userId]);
    return result.rows;
  },

  async markNotificationRead(notificationId: string, userId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO notification_reads (notification_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [notificationId, userId]);
    return { ok: true };
  },

  async getUnreadCount(userId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT COUNT(n.id)::text AS "count"
      FROM notifications n
      WHERE (n.target_user_id IS NULL OR n.target_user_id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM notification_reads nr
          WHERE nr.notification_id = n.id AND nr.user_id = $1
        )
    `, [userId]);
    return Number(result.rows[0]?.count ?? 0);
  },

  // --- Node Token Methods ---

  async createNodeToken(params: { userId: string; label: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    const id = randomUUID();
    const rawToken = `ntok_${randomUUID()}`;
    const hashedToken = hashApiKey(rawToken);
    await currentPool.query(`
      INSERT INTO node_tokens (id, user_id, label, hashed_token, status, created_at)
      VALUES ($1, $2, $3, $4, 'active', NOW())
    `, [id, params.userId, params.label, hashedToken]);
    return { id, rawToken };
  },

  async listNodeTokens(userId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        id,
        user_id AS "userId",
        label,
        status,
        created_at AS "createdAt",
        last_used_at AS "lastUsedAt"
      FROM node_tokens
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    return result.rows;
  },

  async revokeNodeToken(params: { userId: string; tokenId: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      UPDATE node_tokens SET status = 'revoked'
      WHERE id = $1 AND user_id = $2 AND status = 'active'
    `, [params.tokenId, params.userId]);
    return (result.rowCount ?? 0) > 0;
  },

  async authenticateNodeToken(rawToken: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const hashedToken = hashApiKey(rawToken);
    const result = await currentPool.query(`
      SELECT
        id AS "nodeTokenId",
        user_id AS "userId",
        id AS "tokenId"
      FROM node_tokens
      WHERE hashed_token = $1 AND status = 'active'
      LIMIT 1
    `, [hashedToken]);
    if (!result.rows[0]) return null;
    await currentPool.query(`UPDATE node_tokens SET last_used_at = NOW() WHERE id = $1`, [result.rows[0].nodeTokenId]);
    return result.rows[0];
  },

  // --- Node Instance Methods ---

  async upsertNode(params: { nodeId: string; userId: string; tokenId: string; ipAddress?: string; userAgent?: string; capabilities?: any[] }) {
    await ensureDevSeed();
    const currentPool = getPool();
    const caps = params.capabilities ? JSON.stringify(params.capabilities) : '[]';
    await currentPool.query(`
      INSERT INTO nodes (id, user_id, token_id, ip_address, user_agent, capabilities, status, last_heartbeat_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'online', NOW(), NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent,
        capabilities = EXCLUDED.capabilities,
        status = 'online',
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    `, [params.nodeId, params.userId, params.tokenId, params.ipAddress ?? null, params.userAgent ?? null, caps]);
  },

  async updateNodeStatus(params: { nodeId: string; status: string; lastHeartbeatAt?: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      UPDATE nodes SET status = $2, last_heartbeat_at = COALESCE($3::timestamptz, NOW()), updated_at = NOW()
      WHERE id = $1
    `, [params.nodeId, params.status, params.lastHeartbeatAt ?? null]);
  },

  async updateNodeCapabilities(params: { nodeId: string; capabilities: any[] }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      UPDATE nodes SET capabilities = $2::jsonb, updated_at = NOW()
      WHERE id = $1
    `, [params.nodeId, JSON.stringify(params.capabilities)]);
  },

  async listUserNodes(userId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        id,
        user_id AS "userId",
        token_id AS "tokenId",
        ip_address AS "ipAddress",
        user_agent AS "userAgent",
        capabilities,
        status,
        last_heartbeat_at AS "lastHeartbeatAt",
        total_requests AS "totalRequests",
        failed_requests AS "failedRequests",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM nodes
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    return result.rows;
  },

  async getNode(nodeId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        id,
        user_id AS "userId",
        token_id AS "tokenId",
        ip_address AS "ipAddress",
        user_agent AS "userAgent",
        capabilities,
        status,
        last_heartbeat_at AS "lastHeartbeatAt",
        total_requests AS "totalRequests",
        failed_requests AS "failedRequests",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM nodes
      WHERE id = $1
      LIMIT 1
    `, [nodeId]);
    return result.rows[0] ?? null;
  },

  async listOnlineNodes() {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        id,
        user_id AS "userId",
        token_id AS "tokenId",
        ip_address AS "ipAddress",
        capabilities,
        status,
        last_heartbeat_at AS "lastHeartbeatAt",
        total_requests AS "totalRequests",
        failed_requests AS "failedRequests"
      FROM nodes
      WHERE status = 'online'
      ORDER BY last_heartbeat_at DESC
    `);
    return result.rows;
  },

  async setNodeOffline(nodeId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      UPDATE nodes SET status = 'offline', updated_at = NOW() WHERE id = $1
    `, [nodeId]);
  },

  async incrementNodeStats(params: { nodeId: string; success: boolean }) {
    await ensureDevSeed();
    const currentPool = getPool();
    if (params.success) {
      await currentPool.query(`
        UPDATE nodes SET total_requests = total_requests + 1, updated_at = NOW() WHERE id = $1
      `, [params.nodeId]);
    } else {
      await currentPool.query(`
        UPDATE nodes SET total_requests = total_requests + 1, failed_requests = failed_requests + 1, updated_at = NOW() WHERE id = $1
      `, [params.nodeId]);
    }
  },

  // --- Node Preferences ---

  async getNodePreferences(userId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        user_id AS "userId",
        allow_distributed_nodes AS "allowDistributedNodes",
        trust_mode AS "trustMode",
        trusted_supplier_ids AS "trustedSupplierIds",
        trusted_offering_ids AS "trustedOfferingIds",
        updated_at AS "updatedAt"
      FROM user_node_preferences
      WHERE user_id = $1
      LIMIT 1
    `, [userId]);
    return result.rows[0] ?? null;
  },

  async upsertNodePreferences(params: { userId: string; allowDistributedNodes: boolean; trustMode: string; trustedSupplierIds: string[]; trustedOfferingIds: string[] }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO user_node_preferences (user_id, allow_distributed_nodes, trust_mode, trusted_supplier_ids, trusted_offering_ids, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        allow_distributed_nodes = EXCLUDED.allow_distributed_nodes,
        trust_mode = EXCLUDED.trust_mode,
        trusted_supplier_ids = EXCLUDED.trusted_supplier_ids,
        trusted_offering_ids = EXCLUDED.trusted_offering_ids,
        updated_at = NOW()
    `, [params.userId, params.allowDistributedNodes, params.trustMode, JSON.stringify(params.trustedSupplierIds), JSON.stringify(params.trustedOfferingIds)]);
  },

  // --- Node Offerings ---

  async createNodeOffering(params: { offeringId: string; ownerUserId: string; nodeId: string; logicalModel: string; realModel: string; pricingMode: string; fixedPricePer1kInput: number; fixedPricePer1kOutput: number; description?: string; maxConcurrency?: number }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO offerings (id, owner_user_id, logical_model, real_model, pricing_mode, fixed_price_per_1k_input, fixed_price_per_1k_output, execution_mode, node_id, credential_id, enabled, review_status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'node', $8, '', true, 'approved', NOW())
    `, [params.offeringId, params.ownerUserId, params.logicalModel, params.realModel, params.pricingMode, params.fixedPricePer1kInput, params.fixedPricePer1kOutput, params.nodeId]);
  },

  async findOfferingsForModelWithNodes(params: { logicalModel: string; userId?: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        o.id,
        o.owner_user_id AS "ownerUserId",
        o.logical_model AS "logicalModel",
        o.real_model AS "realModel",
        o.pricing_mode AS "pricingMode",
        o.fixed_price_per_1k_input AS "fixedPricePer1kInput",
        o.fixed_price_per_1k_output AS "fixedPricePer1kOutput",
        o.execution_mode AS "executionMode",
        o.node_id AS "nodeId",
        n.status AS "nodeStatus",
        n.last_heartbeat_at AS "nodeLastHeartbeatAt"
      FROM offerings o
      JOIN nodes n ON n.id = o.node_id
      WHERE o.logical_model = $1
        AND o.execution_mode = 'node'
        AND o.enabled = true
        AND o.review_status = 'approved'
        AND n.status = 'online'
      ORDER BY o.fixed_price_per_1k_input ASC
    `, [params.logicalModel]);
    return result.rows;
  },

  async setNodeOfferingsAvailability(params: { nodeId: string; available: boolean }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      UPDATE offerings SET enabled = $2 WHERE node_id = $1 AND execution_mode = 'node'
    `, [params.nodeId, params.available]);
  },

  // --- Social: Votes ---

  async castVote(params: { userId: string; offeringId: string; vote: 'upvote' | 'downvote' }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO offering_votes (user_id, offering_id, vote, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id, offering_id) DO UPDATE SET vote = $3, updated_at = NOW()
    `, [params.userId, params.offeringId, params.vote]);
  },

  async removeVote(params: { userId: string; offeringId: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      DELETE FROM offering_votes WHERE user_id = $1 AND offering_id = $2
    `, [params.userId, params.offeringId]);
  },

  async getVoteSummary(offeringId: string, userId?: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const countsResult = await currentPool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN vote = 'upvote' THEN 1 ELSE 0 END), 0)::int AS "upvotes",
        COALESCE(SUM(CASE WHEN vote = 'downvote' THEN 1 ELSE 0 END), 0)::int AS "downvotes"
      FROM offering_votes
      WHERE offering_id = $1
    `, [offeringId]);
    let myVote: string | null = null;
    if (userId) {
      const myResult = await currentPool.query(`
        SELECT vote FROM offering_votes WHERE user_id = $1 AND offering_id = $2 LIMIT 1
      `, [userId, offeringId]);
      myVote = myResult.rows[0]?.vote ?? null;
    }
    return {
      upvotes: countsResult.rows[0]?.upvotes ?? 0,
      downvotes: countsResult.rows[0]?.downvotes ?? 0,
      myVote
    };
  },

  // --- Social: Favorites ---

  async addFavorite(params: { userId: string; offeringId: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO offering_favorites (user_id, offering_id, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, offering_id) DO NOTHING
    `, [params.userId, params.offeringId]);
  },

  async removeFavorite(params: { userId: string; offeringId: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      DELETE FROM offering_favorites WHERE user_id = $1 AND offering_id = $2
    `, [params.userId, params.offeringId]);
  },

  async listFavorites(userId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        f.offering_id AS "offeringId",
        f.created_at AS "createdAt",
        o.logical_model AS "logicalModel",
        o.real_model AS "realModel",
        o.owner_user_id AS "ownerUserId",
        o.fixed_price_per_1k_input AS "fixedPricePer1kInput",
        o.fixed_price_per_1k_output AS "fixedPricePer1kOutput"
      FROM offering_favorites f
      JOIN offerings o ON o.id = f.offering_id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
    `, [userId]);
    return result.rows;
  },

  // --- Social: Comments ---

  async addComment(params: { commentId: string; userId: string; offeringId: string; content: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO offering_comments (id, user_id, offering_id, content, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [params.commentId, params.userId, params.offeringId, params.content]);
  },

  async listComments(params: { offeringId: string; limit?: number; offset?: number }) {
    await ensureDevSeed();
    const currentPool = getPool();
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const result = await currentPool.query(`
      SELECT
        c.id,
        c.user_id AS "userId",
        c.offering_id AS "offeringId",
        c.content,
        c.created_at AS "createdAt",
        u.display_name AS "displayName",
        u.handle,
        u.avatar_url AS "avatarUrl"
      FROM offering_comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.offering_id = $1
      ORDER BY c.created_at DESC
      LIMIT $2 OFFSET $3
    `, [params.offeringId, limit, offset]);
    return result.rows;
  },

  async deleteComment(params: { commentId: string; userId?: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    let result;
    if (params.userId) {
      result = await currentPool.query(`
        DELETE FROM offering_comments WHERE id = $1 AND user_id = $2
      `, [params.commentId, params.userId]);
    } else {
      result = await currentPool.query(`
        DELETE FROM offering_comments WHERE id = $1
      `, [params.commentId]);
    }
    return (result.rowCount ?? 0) > 0;
  },

  // --- Connection Pool ---

  async joinConnectionPool(params: { userId: string; offeringId: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      INSERT INTO user_connection_pool (user_id, offering_id, joined_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, offering_id) DO NOTHING
    `, [params.userId, params.offeringId]);
  },

  async leaveConnectionPool(params: { userId: string; offeringId: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    await currentPool.query(`
      DELETE FROM user_connection_pool WHERE user_id = $1 AND offering_id = $2
    `, [params.userId, params.offeringId]);
  },

  async listConnectionPool(userId: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        cp.offering_id AS "offeringId",
        cp.joined_at AS "joinedAt",
        o.logical_model AS "logicalModel",
        o.real_model AS "realModel",
        o.owner_user_id AS "ownerUserId",
        o.execution_mode AS "executionMode",
        o.fixed_price_per_1k_input AS "fixedPricePer1kInput",
        o.fixed_price_per_1k_output AS "fixedPricePer1kOutput"
      FROM user_connection_pool cp
      JOIN offerings o ON o.id = cp.offering_id
      WHERE cp.user_id = $1
      ORDER BY cp.joined_at DESC
    `, [userId]);
    return result.rows;
  },

  // --- Market ---

  async listMarketOfferings(params: { page?: number; limit?: number; executionMode?: string; logicalModel?: string; sort?: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [`o.enabled = true`, `o.review_status = 'approved'`, `o.owner_user_id NOT LIKE '%_demo'`];
    const values: any[] = [];
    let paramIdx = 1;

    if (params.executionMode) {
      conditions.push(`o.execution_mode = $${paramIdx}`);
      values.push(params.executionMode);
      paramIdx++;
    }
    if (params.logicalModel) {
      conditions.push(`o.logical_model = $${paramIdx}`);
      values.push(params.logicalModel);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    let orderBy = 'o.created_at DESC';
    if (params.sort === 'price_asc') orderBy = 'o.fixed_price_per_1k_input ASC';
    else if (params.sort === 'price_desc') orderBy = 'o.fixed_price_per_1k_input DESC';
    else if (params.sort === 'votes') orderBy = '"upvotes" DESC';

    const countResult = await currentPool.query(`
      SELECT COUNT(*)::int AS "total" FROM offerings o WHERE ${whereClause}
    `, values);

    const dataResult = await currentPool.query(`
      SELECT
        o.id,
        o.owner_user_id AS "ownerUserId",
        o.logical_model AS "logicalModel",
        o.real_model AS "realModel",
        o.pricing_mode AS "pricingMode",
        o.fixed_price_per_1k_input AS "fixedPricePer1kInput",
        o.fixed_price_per_1k_output AS "fixedPricePer1kOutput",
        o.execution_mode AS "executionMode",
        o.node_id AS "nodeId",
        o.created_at AS "createdAt",
        u.display_name AS "ownerDisplayName",
        u.handle AS "ownerHandle",
        COALESCE(v.up, 0)::int AS "upvotes",
        COALESCE(v.down, 0)::int AS "downvotes",
        COALESCE(fav.cnt, 0)::int AS "favoriteCount"
      FROM offerings o
      JOIN users u ON u.id = o.owner_user_id
      LEFT JOIN (
        SELECT offering_id,
          SUM(CASE WHEN vote = 'upvote' THEN 1 ELSE 0 END) AS up,
          SUM(CASE WHEN vote = 'downvote' THEN 1 ELSE 0 END) AS down
        FROM offering_votes GROUP BY offering_id
      ) v ON v.offering_id = o.id
      LEFT JOIN (
        SELECT offering_id, COUNT(*) AS cnt FROM offering_favorites GROUP BY offering_id
      ) fav ON fav.offering_id = o.id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...values, limit, offset]);

    return { data: dataResult.rows, total: countResult.rows[0]?.total ?? 0 };
  },

  async getMarketOffering(params: { offeringId: string; userId?: string }) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        o.id,
        o.owner_user_id AS "ownerUserId",
        o.logical_model AS "logicalModel",
        o.real_model AS "realModel",
        o.pricing_mode AS "pricingMode",
        o.fixed_price_per_1k_input AS "fixedPricePer1kInput",
        o.fixed_price_per_1k_output AS "fixedPricePer1kOutput",
        o.execution_mode AS "executionMode",
        o.node_id AS "nodeId",
        o.created_at AS "createdAt",
        u.display_name AS "ownerDisplayName",
        u.handle AS "ownerHandle"
      FROM offerings o
      JOIN users u ON u.id = o.owner_user_id
      WHERE o.id = $1 AND o.enabled = true AND o.review_status = 'approved'
      LIMIT 1
    `, [params.offeringId]);
    if (!result.rows[0]) return null;

    const offering = result.rows[0];
    const voteSummary = await this.getVoteSummary(params.offeringId, params.userId);
    return { ...offering, ...voteSummary };
  },

  // --- User Profile ---

  async getPublicUserProfile(handle: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        u.id,
        u.display_name AS "displayName",
        u.handle,
        u.avatar_url AS "avatarUrl",
        u.created_at AS "createdAt"
      FROM users u
      WHERE u.handle = $1
      LIMIT 1
    `, [handle]);
    return result.rows[0] ?? null;
  },

  async listUserOfferings(handle: string) {
    await ensureDevSeed();
    const currentPool = getPool();
    const result = await currentPool.query(`
      SELECT
        o.id,
        o.logical_model AS "logicalModel",
        o.real_model AS "realModel",
        o.pricing_mode AS "pricingMode",
        o.fixed_price_per_1k_input AS "fixedPricePer1kInput",
        o.fixed_price_per_1k_output AS "fixedPricePer1kOutput",
        o.execution_mode AS "executionMode",
        o.created_at AS "createdAt"
      FROM offerings o
      JOIN users u ON u.id = o.owner_user_id
      WHERE u.handle = $1 AND o.enabled = true AND o.review_status = 'approved'
      ORDER BY o.created_at DESC
    `, [handle]);
    return result.rows;
  },

  devUserApiKey: DEV_USER_API_KEY,
  devAdminApiKey: DEV_ADMIN_API_KEY
};
