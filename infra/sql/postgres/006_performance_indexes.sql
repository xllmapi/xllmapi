-- 006: Performance indexes for query-heavy paths
-- Consumption queries (by requester)
CREATE INDEX IF NOT EXISTS idx_api_requests_requester_created
  ON api_requests (requester_user_id, created_at DESC);

-- Supply queries (by offering)
CREATE INDEX IF NOT EXISTS idx_api_requests_offering_created
  ON api_requests (chosen_offering_id, created_at DESC);

-- Trend/admin queries (by date)
CREATE INDEX IF NOT EXISTS idx_api_requests_created
  ON api_requests (created_at DESC);

-- Model filtering
CREATE INDEX IF NOT EXISTS idx_api_requests_model_created
  ON api_requests (logical_model, created_at DESC);

-- Settlement lookups
CREATE INDEX IF NOT EXISTS idx_settlement_consumer_created
  ON settlement_records (consumer_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_supplier_created
  ON settlement_records (supplier_user_id, created_at DESC);

-- Ledger balance queries
CREATE INDEX IF NOT EXISTS idx_ledger_user_created
  ON ledger_entries (user_id, created_at DESC);

-- Pricing constraints
ALTER TABLE offerings ADD CONSTRAINT chk_input_price_positive
  CHECK (fixed_price_per_1k_input >= 0);

ALTER TABLE offerings ADD CONSTRAINT chk_output_price_positive
  CHECK (fixed_price_per_1k_output >= 0);
