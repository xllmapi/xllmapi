-- Per-provider custom headers for upstream request customization.
-- Supports force/fallback modes for header values.

ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS custom_headers JSONB;
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS custom_headers JSONB;

-- Kimi Coding only accepts "claude-code/*" User-Agent
UPDATE provider_presets
SET custom_headers = '{"headers":{"user-agent":{"value":"claude-code/1.0","mode":"force"}}}'::jsonb
WHERE id = 'kimi-coding';

-- Default User-Agent for upstream proxy requests (admin-configurable)
INSERT INTO platform_config (key, value) VALUES ('default_proxy_user_agent', 'xllmapi/1.0')
ON CONFLICT (key) DO NOTHING;
