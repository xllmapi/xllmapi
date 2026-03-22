-- 007: Notifications system + platform config

-- Notifications (announcements, system alerts, personal messages)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('announcement', 'system', 'personal')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  target_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_target_created
  ON notifications (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_type_created
  ON notifications (type, created_at DESC);

-- Notification read tracking
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

-- Platform configuration (key-value store)
CREATE TABLE IF NOT EXISTS platform_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id)
);

-- Seed default config values
INSERT INTO platform_config (key, value) VALUES
  ('initial_token_credit', '1000000'),
  ('supplier_reward_rate', '0.85'),
  ('chat_rate_limit_per_minute', '60'),
  ('default_invitation_quota', '5'),
  ('min_input_price_per_1k', '100'),
  ('min_output_price_per_1k', '200'),
  ('max_input_price_per_1k', '10000'),
  ('max_output_price_per_1k', '20000')
ON CONFLICT (key) DO NOTHING;
