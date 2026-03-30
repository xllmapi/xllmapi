-- Key preview + offering archive + API key limit

-- Offering archive fields
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- Provider credential key preview + created_at
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS api_key_preview TEXT;
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- API key creation limit per user
INSERT INTO platform_config (key, value) VALUES ('max_api_keys_per_user', '5')
ON CONFLICT (key) DO NOTHING;
