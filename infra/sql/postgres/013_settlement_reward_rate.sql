-- 013: Add supplier_reward_rate to settlement_records
ALTER TABLE settlement_records ADD COLUMN IF NOT EXISTS supplier_reward_rate NUMERIC(5,4);
