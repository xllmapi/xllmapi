-- Failed API requests table (no FK constraint on offering, unlike api_requests)
-- Records requests that failed before reaching any offering (e.g., daily limit exhausted, no offerings available)
CREATE TABLE IF NOT EXISTS failed_api_requests (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL,
  logical_model TEXT NOT NULL,
  error_message TEXT NOT NULL,
  client_ip TEXT,
  client_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_api_requests_created ON failed_api_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failed_api_requests_model ON failed_api_requests (logical_model, created_at DESC);
