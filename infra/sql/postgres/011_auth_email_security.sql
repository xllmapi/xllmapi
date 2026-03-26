CREATE TABLE IF NOT EXISTS auth_email_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT,
  token_hash TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  target_email TEXT,
  invitation_id TEXT REFERENCES invitations(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  send_count INTEGER NOT NULL DEFAULT 1,
  last_sent_at TIMESTAMPTZ,
  verify_attempt_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_email_purpose_created
  ON auth_email_challenges (email, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_user_purpose_created
  ON auth_email_challenges (user_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS email_delivery_attempts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  template_key TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  challenge_id TEXT REFERENCES auth_email_challenges(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_attempts_created
  ON email_delivery_attempts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_delivery_attempts_to_email_created
  ON email_delivery_attempts (to_email, created_at DESC);

CREATE TABLE IF NOT EXISTS email_change_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES auth_email_challenges(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  requested_ip TEXT,
  requested_user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_change_requests_user_created
  ON email_change_requests (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user_created
  ON security_events (user_id, created_at DESC);
