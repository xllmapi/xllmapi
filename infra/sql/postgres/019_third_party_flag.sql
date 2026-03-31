-- Third-party provider label on presets
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS third_party BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS third_party_label TEXT;
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'high';
