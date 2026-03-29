-- Request context: store client IP, User-Agent (client + upstream), and API key ID per request.

ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS client_ip TEXT;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS client_user_agent TEXT;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS upstream_user_agent TEXT;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS api_key_id TEXT;
