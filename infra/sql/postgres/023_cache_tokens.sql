-- 023: Cache token support for differential pricing
-- Tracks cache read/creation tokens separately from regular input tokens
-- Adds cache discount rate to offerings

-- api_requests: cache token breakdown
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER DEFAULT 0;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER DEFAULT 0;

-- offerings: cache hit discount (1-100%, default 50% = half price for cached input)
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS cache_read_discount INTEGER DEFAULT 50;
