-- Store human-friendly provider name (e.g., "Kimi Coding", "DeepSeek") alongside technical provider_type.

ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS provider_label TEXT;
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS provider_label TEXT;

-- Backfill existing credentials from presets by matching base_url
UPDATE provider_credentials c
SET provider_label = p.label
FROM provider_presets p
WHERE c.base_url = p.base_url AND c.provider_label IS NULL;
