-- 023: Cache token support for differential pricing
-- Tracks cache read/creation tokens separately from regular input tokens
-- Adds cache discount rate to offerings

-- api_requests: cache token breakdown
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER DEFAULT 0;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER DEFAULT 0;

-- offerings: cache hit discount (1-100%, default NULL = use platform default from platform_config)
-- NULL means "not explicitly set, use global default_cache_read_discount"
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS cache_read_discount INTEGER DEFAULT NULL;
