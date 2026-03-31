-- 021: Admin panel enhancements — node status model + latency tracking

-- 1. Node disabled-by tracking (who/what disabled an offering)
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS disabled_by TEXT
  CHECK (disabled_by IN ('admin_stop', 'admin_ban', 'owner', 'auto'));

-- 2. Latency tracking columns on api_requests
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_total_ms INTEGER;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_ttfb_ms INTEGER;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_queue_ms INTEGER;
ALTER TABLE api_requests ADD COLUMN IF NOT EXISTS latency_upstream_ms INTEGER;

-- 3. Index for per-offering recent requests lookup
CREATE INDEX IF NOT EXISTS idx_api_requests_offering_recent
  ON api_requests (chosen_offering_id, created_at DESC)
  WHERE status IS NOT NULL;
