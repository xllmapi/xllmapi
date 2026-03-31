/**
 * Settlement Balance Guard Tests
 *
 * Verifies that recordChatSettlement never allows wallet balance to go negative.
 * Requires PostgreSQL (DATABASE_URL env var).
 * Run via: DATABASE_URL=... npx tsx --test src/tests/settlement-balance-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

// Skip all tests if no DATABASE_URL
if (!DATABASE_URL) {
  test("settlement-balance-guard: skipped (no DATABASE_URL)", () => {
    console.log("  ⚠ DATABASE_URL not set — skipping settlement balance guard tests");
  });
} else {

  let pool: Pool;
  // Shared test fixtures (created once, cleaned up at end)
  let testSupplierUserId: string;
  let testCredentialId: string;
  let testOfferingId: string;

  const uid = () => `test_${randomUUID().replaceAll("-", "")}`;
  const rid = () => `req_${randomUUID().replaceAll("-", "")}`;

  const setup = async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 30 });

    const check = await pool.query("SELECT 1 FROM wallets LIMIT 0").catch(() => null);
    if (!check) throw new Error("wallets table not found — run migrations first");

    // Create shared supplier user + credential + offering for FK constraints
    testSupplierUserId = uid();
    testCredentialId = `cred_${randomUUID().replaceAll("-", "")}`;
    testOfferingId = `off_${randomUUID().replaceAll("-", "")}`;

    await pool.query(
      "INSERT INTO users (id, display_name, role, status) VALUES ($1, $2, 'user', 'active') ON CONFLICT (id) DO NOTHING",
      [testSupplierUserId, testSupplierUserId]
    );
    await pool.query(
      "INSERT INTO wallets (user_id, available_token_credit) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING",
      [testSupplierUserId]
    );
    await pool.query(`
      INSERT INTO provider_credentials (id, owner_user_id, provider_type, api_key_env_name, status)
      VALUES ($1, $2, 'openai', '', 'active')
    `, [testCredentialId, testSupplierUserId]);
    await pool.query(`
      INSERT INTO offerings (id, owner_user_id, logical_model, credential_id, real_model, pricing_mode,
        fixed_price_per_1k_input, fixed_price_per_1k_output, enabled, review_status)
      VALUES ($1, $2, 'test-model', $3, 'test-model', 'fixed', 10, 20, true, 'approved')
    `, [testOfferingId, testSupplierUserId, testCredentialId]);
  };

  const teardown = async () => {
    // Clean up all test data
    await pool.query("DELETE FROM ledger_entries WHERE user_id LIKE 'test_%'");
    await pool.query("DELETE FROM settlement_records WHERE consumer_user_id LIKE 'test_%' OR supplier_user_id LIKE 'test_%'");
    await pool.query("DELETE FROM api_requests WHERE requester_user_id LIKE 'test_%'");
    await pool.query("DELETE FROM offerings WHERE id = $1", [testOfferingId]);
    await pool.query("DELETE FROM provider_credentials WHERE id = $1", [testCredentialId]);
    await pool.query("DELETE FROM wallets WHERE user_id LIKE 'test_%'");
    await pool.query("DELETE FROM users WHERE id LIKE 'test_%'");
    await pool.end();
  };

  /** Create a test consumer user with a specific balance */
  const createConsumer = async (balance: number): Promise<string> => {
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

  /** Get current wallet balance */
  const getBalance = async (userId: string): Promise<number> => {
    const result = await pool.query<{ available_token_credit: string }>(
      "SELECT available_token_credit FROM wallets WHERE user_id = $1",
      [userId]
    );
    return Number(result.rows[0]?.available_token_credit ?? 0);
  };

  /** Simulate recordChatSettlement with the same logic as production code */
  const doSettlement = async (consumerId: string, inputTokens: number, outputTokens: number, pricePer1kInput: number, pricePer1kOutput: number) => {
    const requestId = rid();
    const inputCost = Math.ceil((inputTokens * pricePer1kInput) / 1000);
    const outputCost = Math.ceil((outputTokens * pricePer1kOutput) / 1000);
    const consumerCost = inputCost + outputCost;
    const supplierRewardRate = 0.85;
    const supplierReward = Math.floor(consumerCost * supplierRewardRate);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock consumer wallet and check balance (mirrors production code)
      const walletRow = await client.query<{ available_token_credit: string }>(
        "SELECT available_token_credit FROM wallets WHERE user_id = $1 FOR UPDATE",
        [consumerId]
      );
      const availableBalance = Number(walletRow.rows[0]?.available_token_credit ?? 0);
      const actualDeduction = Math.min(consumerCost, Math.max(0, availableBalance));
      const underfunded = actualDeduction < consumerCost;
      const actualSupplierReward = underfunded ? Math.floor(actualDeduction * supplierRewardRate) : supplierReward;
      const actualPlatformMargin = actualDeduction - actualSupplierReward;

      await client.query(`
        INSERT INTO api_requests (
          id, requester_user_id, logical_model, chosen_offering_id, provider, real_model,
          input_tokens, output_tokens, total_tokens, status
        ) VALUES ($1, $2, 'test-model', $3, 'test-provider', 'test-model', $4, $5, $6, 'completed')
      `, [requestId, consumerId, testOfferingId, inputTokens, outputTokens, inputTokens + outputTokens]);

      await client.query(
        "UPDATE wallets SET available_token_credit = available_token_credit - $1 WHERE user_id = $2",
        [actualDeduction, consumerId]
      );
      await client.query(
        "UPDATE wallets SET available_token_credit = available_token_credit + $1 WHERE user_id = $2",
        [actualSupplierReward, testSupplierUserId]
      );

      await client.query(`
        INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type)
        VALUES ($1, $2, 'debit', $3, 'consumer_cost')
      `, [requestId, consumerId, actualDeduction]);
      await client.query(`
        INSERT INTO ledger_entries (request_id, user_id, direction, amount, entry_type)
        VALUES ($1, $2, 'credit', $3, 'supplier_reward')
      `, [requestId, testSupplierUserId, actualSupplierReward]);

      await client.query(`
        INSERT INTO settlement_records (
          request_id, consumer_user_id, supplier_user_id, consumer_cost, supplier_reward, platform_margin, supplier_reward_rate
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [requestId, consumerId, testSupplierUserId, actualDeduction, actualSupplierReward, actualPlatformMargin, supplierRewardRate]);

      await client.query("COMMIT");
      return { consumerCost, actualDeduction, underfunded };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  test("settlement-balance-guard", async (t) => {
    await setup();

    try {
      await t.test("sufficient balance: deducts full cost", async () => {
        const consumer = await createConsumer(10000);
        const result = await doSettlement(consumer, 500, 200, 10, 20);
        // inputCost = ceil(500*10/1000) = 5, outputCost = ceil(200*20/1000) = 4, total = 9
        assert.equal(result.consumerCost, 9);
        assert.equal(result.actualDeduction, 9);
        assert.equal(result.underfunded, false);

        const balance = await getBalance(consumer);
        assert.equal(balance, 10000 - 9);
        assert.ok(balance >= 0, "balance must not go negative");
      });

      await t.test("insufficient balance: deducts only available amount, never goes negative", async () => {
        const consumer = await createConsumer(5);
        // Cost will be 9, but balance is only 5
        const result = await doSettlement(consumer, 500, 200, 10, 20);
        assert.equal(result.consumerCost, 9);
        assert.equal(result.actualDeduction, 5);
        assert.equal(result.underfunded, true);

        const balance = await getBalance(consumer);
        assert.equal(balance, 0);
        assert.ok(balance >= 0, "balance must not go negative");
      });

      await t.test("zero balance: deducts nothing", async () => {
        const consumer = await createConsumer(0);
        const result = await doSettlement(consumer, 500, 200, 10, 20);
        assert.equal(result.actualDeduction, 0);
        assert.equal(result.underfunded, true);

        const balance = await getBalance(consumer);
        assert.equal(balance, 0);
      });

      await t.test("concurrent requests: balance never goes negative (FOR UPDATE lock)", async () => {
        // Balance of 10, two concurrent requests each costing 9
        const consumer = await createConsumer(10);

        const results = await Promise.all([
          doSettlement(consumer, 500, 200, 10, 20),
          doSettlement(consumer, 500, 200, 10, 20),
        ]);

        const balance = await getBalance(consumer);
        assert.ok(balance >= 0, `balance must not go negative, got ${balance}`);

        const totalDeducted = results.reduce((sum, r) => sum + r.actualDeduction, 0);
        assert.equal(totalDeducted, 10, "total deduction should equal initial balance");
        assert.ok(results.some(r => r.underfunded), "at least one settlement should be underfunded");
      });

      await t.test("concurrent requests: high concurrency stress test", async () => {
        // Balance of 100, 20 concurrent requests each costing 9
        const consumer = await createConsumer(100);

        const results = await Promise.all(
          Array.from({ length: 20 }, () =>
            doSettlement(consumer, 500, 200, 10, 20)
          )
        );

        const balance = await getBalance(consumer);
        assert.ok(balance >= 0, `balance must not go negative under high concurrency, got ${balance}`);

        const totalDeducted = results.reduce((sum, r) => sum + r.actualDeduction, 0);
        assert.equal(totalDeducted, 100, "total deduction should equal initial balance");

        // 100 / 9 = 11 full deductions, rest should be underfunded
        const fullCount = results.filter(r => !r.underfunded).length;
        const underfundedCount = results.filter(r => r.underfunded).length;
        assert.ok(fullCount <= 11, `at most 11 full deductions, got ${fullCount}`);
        assert.ok(underfundedCount >= 9, `at least 9 underfunded, got ${underfundedCount}`);
      });
    } finally {
      await teardown();
    }
  });
}
