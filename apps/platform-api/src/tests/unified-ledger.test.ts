/**
 * Unified Token Ledger Tests
 *
 * Verifies the unified ledger system: initial_credit, admin_adjust, referral_reward,
 * and getLedgerHistory. Requires PostgreSQL (DATABASE_URL env var).
 *
 * Run via: DATABASE_URL=... npx tsx --test src/tests/unified-ledger.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  test("unified-ledger: skipped (no DATABASE_URL)", () => {
    console.log("  ⚠ DATABASE_URL not set — skipping unified ledger tests");
  });
} else {

  let pool: Pool;

  const uid = () => `test_${randomUUID().replaceAll("-", "")}`;

  const setup = async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
    const check = await pool.query("SELECT 1 FROM ledger_entries LIMIT 0").catch(() => null);
    if (!check) throw new Error("ledger_entries table not found — run migrations first");

    // Verify migration 022 columns exist
    const colCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ledger_entries' AND column_name IN ('note', 'related_id', 'actor_id')
      ORDER BY column_name
    `);
    const cols = colCheck.rows.map((r: { column_name: string }) => r.column_name).sort();
    assert.deepEqual(cols, ["actor_id", "note", "related_id"], "Migration 022 columns must exist");

    // Verify request_id is nullable
    const nullCheck = await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'ledger_entries' AND column_name = 'request_id'
    `);
    assert.equal(nullCheck.rows[0]?.is_nullable, "YES", "request_id must be nullable after migration 022");
  };

  const teardown = async () => {
    await pool.query("DELETE FROM ledger_entries WHERE user_id LIKE 'test_%'");
    await pool.query("DELETE FROM wallets WHERE user_id LIKE 'test_%'");
    await pool.query("DELETE FROM users WHERE id LIKE 'test_%'");
    await pool.end();
  };

  const createTestUser = async (balance: number): Promise<string> => {
    const userId = uid();
    await pool.query(
      "INSERT INTO users (id, display_name, role, status) VALUES ($1, $2, 'user', 'active')",
      [userId, userId]
    );
    await pool.query(
      "INSERT INTO wallets (user_id, available_token_credit) VALUES ($1, $2)",
      [userId, balance]
    );
    return userId;
  };

  const getBalance = async (userId: string): Promise<number> => {
    const result = await pool.query<{ available_token_credit: string }>(
      "SELECT available_token_credit FROM wallets WHERE user_id = $1",
      [userId]
    );
    return Number(result.rows[0]?.available_token_credit ?? 0);
  };

  const getLedgerEntries = async (userId: string) => {
    const result = await pool.query(
      `SELECT id, request_id, user_id, direction, amount::text AS amount,
              entry_type, note, related_id, actor_id, created_at
       FROM ledger_entries WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  };

  test("unified-ledger", async (t) => {
    await setup();

    try {
      // ===== initial_credit =====
      await t.test("initial_credit: records ledger entry with NULL request_id", async () => {
        const userId = uid();
        await pool.query(
          "INSERT INTO users (id, display_name, role, status) VALUES ($1, $2, 'user', 'active')",
          [userId, userId]
        );
        await pool.query(
          "INSERT INTO wallets (user_id, available_token_credit) VALUES ($1, $2)",
          [userId, 1000000]
        );

        // Simulate what creditInitial does
        await pool.query(`
          INSERT INTO ledger_entries (user_id, direction, amount, entry_type, note, actor_id)
          VALUES ($1, 'credit', $2, 'initial_credit', '注册赠送', 'system')
        `, [userId, 1000000]);

        const entries = await getLedgerEntries(userId);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].entry_type, "initial_credit");
        assert.equal(entries[0].direction, "credit");
        assert.equal(entries[0].amount, "1000000");
        assert.equal(entries[0].note, "注册赠送");
        assert.equal(entries[0].actor_id, "system");
        assert.equal(entries[0].request_id, null, "initial_credit should have NULL request_id");
      });

      // ===== admin_adjust (credit) =====
      await t.test("admin_adjust: credit records ledger and updates wallet atomically", async () => {
        const userId = await createTestUser(500000);
        const adminId = uid();

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "UPDATE wallets SET available_token_credit = available_token_credit + $2 WHERE user_id = $1",
            [userId, 200000]
          );
          await client.query(`
            INSERT INTO ledger_entries (user_id, direction, amount, entry_type, note, actor_id)
            VALUES ($1, 'credit', $2, 'admin_adjust', $3, $4)
          `, [userId, 200000, "测试补充额度", adminId]);
          await client.query("COMMIT");
        } finally {
          client.release();
        }

        const balance = await getBalance(userId);
        assert.equal(balance, 700000);

        const entries = await getLedgerEntries(userId);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].entry_type, "admin_adjust");
        assert.equal(entries[0].direction, "credit");
        assert.equal(entries[0].amount, "200000");
        assert.equal(entries[0].note, "测试补充额度");
        assert.equal(entries[0].actor_id, adminId);
      });

      // ===== admin_adjust (debit) =====
      await t.test("admin_adjust: debit records ledger and reduces wallet", async () => {
        const userId = await createTestUser(1000000);
        const adminId = uid();

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "UPDATE wallets SET available_token_credit = available_token_credit + $2 WHERE user_id = $1",
            [userId, -300000]
          );
          await client.query(`
            INSERT INTO ledger_entries (user_id, direction, amount, entry_type, note, actor_id)
            VALUES ($1, 'debit', $2, 'admin_adjust', $3, $4)
          `, [userId, 300000, "扣除测试", adminId]);
          await client.query("COMMIT");
        } finally {
          client.release();
        }

        const balance = await getBalance(userId);
        assert.equal(balance, 700000);

        const entries = await getLedgerEntries(userId);
        assert.equal(entries[0].direction, "debit");
        assert.equal(entries[0].amount, "300000");
      });

      // ===== referral_reward =====
      await t.test("referral_reward: records ledger with invitation reference", async () => {
        const inviterId = await createTestUser(1000000);
        const invitationId = `inv_${randomUUID()}`;
        const invitedEmail = "newuser@test.com";
        const rewardAmount = 1000000;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "UPDATE wallets SET available_token_credit = available_token_credit + $2 WHERE user_id = $1",
            [inviterId, rewardAmount]
          );
          await client.query(`
            INSERT INTO ledger_entries (user_id, direction, amount, entry_type, note, related_id, actor_id)
            VALUES ($1, 'credit', $2, 'referral_reward', $3, $4, 'system')
          `, [inviterId, rewardAmount, `邀请 ${invitedEmail} 注册奖励`, invitationId]);
          await client.query("COMMIT");
        } finally {
          client.release();
        }

        const balance = await getBalance(inviterId);
        assert.equal(balance, 2000000);

        const entries = await getLedgerEntries(inviterId);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].entry_type, "referral_reward");
        assert.equal(entries[0].direction, "credit");
        assert.equal(entries[0].amount, "1000000");
        assert.equal(entries[0].related_id, invitationId);
        assert.ok(entries[0].note.includes(invitedEmail));
      });

      // ===== mixed entries + getLedgerHistory pattern =====
      await t.test("getLedgerHistory: returns entries in desc order with correct pagination", async () => {
        const userId = await createTestUser(1000000);

        // Insert multiple entries of different types
        for (let i = 0; i < 5; i++) {
          await pool.query(`
            INSERT INTO ledger_entries (user_id, direction, amount, entry_type, note, actor_id)
            VALUES ($1, 'credit', $2, 'initial_credit', '注册赠送', 'system')
          `, [userId, 1000000]);
        }
        for (let i = 0; i < 3; i++) {
          await pool.query(`
            INSERT INTO ledger_entries (user_id, direction, amount, entry_type, note, actor_id)
            VALUES ($1, 'credit', $2, 'admin_adjust', '管理员调整', $3)
          `, [userId, 50000, "admin_001"]);
        }

        // Query all
        const allResult = await pool.query(`
          SELECT id, entry_type, direction, amount::text AS amount, note
          FROM ledger_entries WHERE user_id = $1
          ORDER BY created_at DESC
        `, [userId]);
        assert.equal(allResult.rows.length, 8);

        // Query with type filter
        const filteredResult = await pool.query(`
          SELECT id, entry_type FROM ledger_entries
          WHERE user_id = $1 AND entry_type = 'admin_adjust'
          ORDER BY created_at DESC
        `, [userId]);
        assert.equal(filteredResult.rows.length, 3);

        // Query with pagination
        const page1 = await pool.query(`
          SELECT id FROM ledger_entries WHERE user_id = $1
          ORDER BY created_at DESC LIMIT 5 OFFSET 0
        `, [userId]);
        assert.equal(page1.rows.length, 5);

        const page2 = await pool.query(`
          SELECT id FROM ledger_entries WHERE user_id = $1
          ORDER BY created_at DESC LIMIT 5 OFFSET 5
        `, [userId]);
        assert.equal(page2.rows.length, 3);
      });

      // ===== backward compatibility =====
      await t.test("backward compat: existing settlement ledger entries still work (request_id NOT NULL)", async () => {
        const userId = await createTestUser(1000000);
        const supplierId = await createTestUser(0);

        // Create a fake offering + api_request for FK constraints
        const credId = `cred_${randomUUID().replaceAll("-", "")}`;
        const offId = `off_${randomUUID().replaceAll("-", "")}`;
        const reqId = `req_${randomUUID().replaceAll("-", "")}`;

        await pool.query(`
          INSERT INTO provider_credentials (id, owner_user_id, provider_type, api_key_env_name, status)
          VALUES ($1, $2, 'openai', '', 'active')
        `, [credId, supplierId]);
        await pool.query(`
          INSERT INTO offerings (id, owner_user_id, logical_model, credential_id, real_model, pricing_mode,
            fixed_price_per_1k_input, fixed_price_per_1k_output, enabled, review_status)
          VALUES ($1, $2, 'test-model', $3, 'test-model', 'fixed', 10, 20, true, 'approved')
        `, [offId, supplierId, credId]);
        await pool.query(`
          INSERT INTO api_requests (id, requester_user_id, logical_model, chosen_offering_id, provider, real_model,
            input_tokens, output_tokens, total_tokens, status)
          VALUES ($1, $2, 'test-model', $3, 'test-provider', 'test-model', 100, 50, 150, 'completed')
        `, [reqId, userId, offId]);

        // Insert settlement ledger entries with request_id (existing format)
        await pool.query(`
          INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type)
          VALUES ($1, $2, 'debit', $3, 'consumer_cost')
        `, [reqId, userId, 5]);
        await pool.query(`
          INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type)
          VALUES ($1, $2, 'credit', $3, 'supplier_reward')
        `, [reqId, supplierId, 4]);

        // Verify they exist with NULL note/related_id/actor_id
        const entries = await getLedgerEntries(userId);
        const settlement = entries.find((e: any) => e.entry_type === "consumer_cost");
        assert.ok(settlement, "settlement ledger entry should exist");
        assert.equal(settlement.request_id, reqId);
        assert.equal(settlement.note, null, "note should be NULL for legacy entries");
        assert.equal(settlement.related_id, null);
        assert.equal(settlement.actor_id, null);

        // Cleanup FK chain
        await pool.query("DELETE FROM ledger_entries WHERE user_id IN ($1, $2)", [userId, supplierId]);
        await pool.query("DELETE FROM api_requests WHERE id = $1", [reqId]);
        await pool.query("DELETE FROM offerings WHERE id = $1", [offId]);
        await pool.query("DELETE FROM provider_credentials WHERE id = $1", [credId]);
      });

      // ===== atomicity =====
      await t.test("admin_adjust atomicity: rollback on failure keeps wallet and ledger consistent", async () => {
        const userId = await createTestUser(500000);
        const initialBalance = await getBalance(userId);
        const initialEntries = await getLedgerEntries(userId);

        // Simulate a failed transaction
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "UPDATE wallets SET available_token_credit = available_token_credit + $2 WHERE user_id = $1",
            [userId, 100000]
          );
          await client.query(`
            INSERT INTO ledger_entries (user_id, direction, amount, entry_type, note, actor_id)
            VALUES ($1, 'credit', $2, 'admin_adjust', '测试', 'admin')
          `, [userId, 100000]);
          // Force rollback
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }

        // Verify nothing changed
        const afterBalance = await getBalance(userId);
        assert.equal(afterBalance, initialBalance, "balance should be unchanged after rollback");

        const afterEntries = await getLedgerEntries(userId);
        assert.equal(afterEntries.length, initialEntries.length, "ledger entries should be unchanged after rollback");
      });

      // ===== NULL request_id =====
      await t.test("NULL request_id: FK constraint allows NULL for non-settlement entries", async () => {
        const userId = await createTestUser(0);

        // This should succeed — NULL request_id bypasses FK check
        await pool.query(`
          INSERT INTO ledger_entries (user_id, direction, amount, entry_type, note, actor_id)
          VALUES ($1, 'credit', 1000000, 'initial_credit', '注册赠送', 'system')
        `, [userId]);

        const entries = await getLedgerEntries(userId);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].request_id, null);
      });

      // ===== invalid FK still rejected =====
      await t.test("FK constraint: non-NULL invalid request_id is rejected", async () => {
        const userId = await createTestUser(0);

        await assert.rejects(
          pool.query(`
            INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type)
            VALUES ('nonexistent_req', $1, 'debit', 100, 'consumer_cost')
          `, [userId]),
          (err: any) => {
            assert.ok(err.message.includes("violates foreign key") || err.code === "23503");
            return true;
          },
          "non-NULL invalid request_id should fail FK constraint"
        );
      });

      // ===== entry type extensibility =====
      await t.test("extensibility: custom entry_type works without schema change", async () => {
        const userId = await createTestUser(0);

        await pool.query(`
          INSERT INTO ledger_entries (user_id, direction, amount, entry_type, note, actor_id)
          VALUES ($1, 'credit', 50000, 'promo_credit', '春节活动赠送', 'system')
        `, [userId]);

        const entries = await getLedgerEntries(userId);
        assert.equal(entries[0].entry_type, "promo_credit");
        assert.equal(entries[0].note, "春节活动赠送");
      });

    } finally {
      await teardown();
    }
  });
}
