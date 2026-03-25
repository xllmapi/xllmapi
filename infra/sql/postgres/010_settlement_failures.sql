CREATE TABLE IF NOT EXISTS settlement_failures (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supplier_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  logical_model TEXT NOT NULL,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  real_model TEXT NOT NULL,
  error_message TEXT NOT NULL,
  settlement_payload JSONB NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_failures_open
  ON settlement_failures (resolved_at, last_failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_failures_requester
  ON settlement_failures (requester_user_id, last_failed_at DESC);
