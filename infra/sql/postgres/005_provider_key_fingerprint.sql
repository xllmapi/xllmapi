ALTER TABLE provider_credentials
  ADD COLUMN IF NOT EXISTS api_key_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_credentials_owner_key
ON provider_credentials (owner_user_id, provider_type, COALESCE(base_url, ''), api_key_fingerprint)
WHERE api_key_fingerprint IS NOT NULL AND api_key_fingerprint <> '';
