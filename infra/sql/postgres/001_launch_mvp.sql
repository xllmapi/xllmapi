CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available_token_credit BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS platform_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  hashed_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  base_url TEXT,
  encrypted_secret TEXT,
  api_key_env_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offerings (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logical_model TEXT NOT NULL,
  credential_id TEXT NOT NULL REFERENCES provider_credentials(id) ON DELETE RESTRICT,
  real_model TEXT NOT NULL,
  pricing_mode TEXT NOT NULL,
  fixed_price_per_1k_input INTEGER NOT NULL,
  fixed_price_per_1k_output INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_requests (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  logical_model TEXT NOT NULL,
  chosen_offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  real_model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_requests_user_idempotency_idx
  ON api_requests (requester_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES api_requests(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL,
  amount BIGINT NOT NULL,
  entry_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_records (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES api_requests(id) ON DELETE RESTRICT,
  consumer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supplier_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consumer_cost BIGINT NOT NULL,
  supplier_reward BIGINT NOT NULL,
  platform_margin BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS offerings_lookup_idx
  ON offerings (logical_model, enabled, review_status);

CREATE INDEX IF NOT EXISTS offerings_owner_idx
  ON offerings (owner_user_id, credential_id);

CREATE INDEX IF NOT EXISTS provider_credentials_owner_idx
  ON provider_credentials (owner_user_id, status);

CREATE INDEX IF NOT EXISTS audit_logs_actor_idx
  ON audit_logs (actor_user_id, created_at DESC);
