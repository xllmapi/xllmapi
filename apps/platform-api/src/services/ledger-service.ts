import { Pool, type PoolClient } from "pg";

// Use lazy import to avoid circular deps — getPool is in the postgres repo
let _getPool: (() => Pool) | null = null;

async function getPool(): Promise<Pool> {
  if (!_getPool) {
    const mod = await import("../repositories/postgres-platform-repository.js");
    _getPool = mod.getPool;
  }
  return _getPool();
}

export type LedgerEntryType =
  | "initial_credit"
  | "consumer_cost"
  | "supplier_reward"
  | "admin_adjust"
  | "referral_reward"
  | "promo_credit"
  | string; // extensible

export interface RecordEntryParams {
  userId: string;
  direction: "credit" | "debit";
  amount: number;
  entryType: LedgerEntryType;
  requestId?: string | null;
  note?: string | null;
  relatedId?: string | null;
  actorId?: string | null;
  client?: PoolClient; // reuse external transaction
}

export interface LedgerHistoryParams {
  userId: string;
  limit?: number;
  offset?: number;
  entryType?: string;
}

export interface LedgerEntry {
  id: number;
  requestId: string | null;
  direction: "credit" | "debit";
  amount: string;
  entryType: string;
  note: string | null;
  relatedId: string | null;
  actorId: string | null;
  createdAt: string;
  logicalModel: string | null;
  provider: string | null;
  providerLabel: string | null;
}

export const ledgerService = {
  /**
   * Low-level: insert a ledger entry. Does NOT update wallet.
   * Use this when wallet update is handled separately (e.g. inside recordChatSettlement).
   * When client is provided, uses that transaction; otherwise uses pool directly.
   */
  async recordEntry(params: RecordEntryParams): Promise<void> {
    const executor = params.client ?? await getPool();
    await executor.query(`
      INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type, note, related_id, actor_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      params.requestId ?? null,
      params.userId,
      params.direction,
      params.amount,
      params.entryType,
      params.note ?? null,
      params.relatedId ?? null,
      params.actorId ?? null,
    ]);
  },

  /**
   * Record initial credit for new user signup.
   * Must be called within the signup transaction (pass client).
   */
  async creditInitial(params: {
    userId: string;
    amount: number;
    client: PoolClient;
  }): Promise<void> {
    await this.recordEntry({
      userId: params.userId,
      direction: "credit",
      amount: params.amount,
      entryType: "initial_credit",
      note: "注册赠送",
      actorId: "system",
      client: params.client,
    });
  },

  /**
   * Admin adjusts user wallet. Manages its own transaction.
   * Atomically updates wallet + writes ledger entry.
   */
  async adminAdjust(params: {
    userId: string;
    amount: number;
    note?: string;
    actorUserId: string;
  }): Promise<void> {
    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE wallets SET available_token_credit = available_token_credit + $2 WHERE user_id = $1",
        [params.userId, params.amount]
      );
      await this.recordEntry({
        userId: params.userId,
        direction: params.amount >= 0 ? "credit" : "debit",
        amount: Math.abs(params.amount),
        entryType: "admin_adjust",
        note: params.note || "管理员调整",
        actorId: params.actorUserId,
        client,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Credit referral reward to inviter.
   * Must be called within the signup transaction (pass client).
   * Caller is responsible for the wallet UPDATE.
   */
  async creditReferral(params: {
    userId: string;
    amount: number;
    invitedEmail: string;
    invitationId: string;
    client: PoolClient;
  }): Promise<void> {
    await this.recordEntry({
      userId: params.userId,
      direction: "credit",
      amount: params.amount,
      entryType: "referral_reward",
      note: `邀请 ${params.invitedEmail} 注册奖励`,
      relatedId: params.invitationId,
      actorId: "system",
      client: params.client,
    });
  },

  /**
   * Query paginated ledger history for a user.
   */
  async getLedgerHistory(params: LedgerHistoryParams): Promise<{ data: LedgerEntry[]; total: number }> {
    const pool = await getPool();
    const conditions: string[] = ["le.user_id = $1"];
    const values: (string | number)[] = [params.userId];
    let idx = 2;

    if (params.entryType) {
      conditions.push(`le.entry_type = $${idx}`);
      values.push(params.entryType);
      idx++;
    }

    const where = conditions.join(" AND ");
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const [dataResult, countResult] = await Promise.all([
      pool.query(`
        SELECT
          le.id,
          le.request_id AS "requestId",
          le.direction,
          le.amount::text AS "amount",
          le.entry_type AS "entryType",
          le.note,
          le.related_id AS "relatedId",
          le.actor_id AS "actorId",
          le.created_at::text AS "createdAt",
          ar.logical_model AS "logicalModel",
          ar.provider,
          ar.provider_label AS "providerLabel"
        FROM ledger_entries le
        LEFT JOIN api_requests ar ON ar.id = le.request_id
        WHERE ${where}
        ORDER BY le.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...values, limit, offset]),
      pool.query(`
        SELECT COUNT(*)::text AS total FROM ledger_entries le WHERE ${where}
      `, values),
    ]);

    return {
      data: dataResult.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  },
};
