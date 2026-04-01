-- 022: Unified ledger — support non-settlement token activity entries
-- Zero-downtime: ADD COLUMN (nullable) + DROP NOT NULL only, no table rewrite

-- 1. Allow NULL request_id for non-settlement entries
--    FK REFERENCES api_requests(id) auto-skips NULL values
ALTER TABLE ledger_entries ALTER COLUMN request_id DROP NOT NULL;

-- 2. Human-readable note (e.g. "注册赠送", admin adjustment reason)
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS note TEXT;

-- 3. Related entity ID (invitation_id, admin_actor_id, etc.)
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS related_id TEXT;

-- 4. Actor who triggered this change (userId or 'system')
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS actor_id TEXT;

-- 5. Referral reward config (0 = disabled)
INSERT INTO platform_config (key, value)
VALUES ('referral_reward_amount', '0')
ON CONFLICT (key) DO NOTHING;
