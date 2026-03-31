-- Add third_party_notice and ensure trust_level exists
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'high';
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS third_party_notice TEXT;
