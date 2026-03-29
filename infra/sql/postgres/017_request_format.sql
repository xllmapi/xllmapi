-- Track API format information per request.

ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS client_format TEXT;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS upstream_format TEXT;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS format_converted BOOLEAN;
