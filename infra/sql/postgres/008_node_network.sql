-- 008_node_network.sql
-- Phase 1: Distributed node network foundation tables

-- Node authentication tokens
CREATE TABLE IF NOT EXISTS node_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hashed_token TEXT NOT NULL UNIQUE,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Connected nodes
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL REFERENCES node_tokens(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  last_heartbeat_at TIMESTAMPTZ,
  capabilities JSONB NOT NULL DEFAULT '[]',
  ip_address TEXT,
  user_agent TEXT,
  connected_at TIMESTAMPTZ,
  reputation_score REAL NOT NULL DEFAULT 1.0,
  total_requests_served BIGINT NOT NULL DEFAULT 0,
  total_success_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extend offerings with execution mode and node reference
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL;

-- User preferences for distributed node routing
CREATE TABLE IF NOT EXISTS user_node_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  allow_distributed_nodes BOOLEAN NOT NULL DEFAULT FALSE,
  trust_mode TEXT NOT NULL DEFAULT 'all',
  trusted_supplier_ids JSONB NOT NULL DEFAULT '[]',
  trusted_offering_ids JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User connection pool (which offerings a user has opted into)
CREATE TABLE IF NOT EXISTS user_connection_pool (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, offering_id)
);

-- Offering votes
CREATE TABLE IF NOT EXISTS offering_votes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('upvote', 'downvote')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, offering_id)
);

-- Offering favorites
CREATE TABLE IF NOT EXISTS offering_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, offering_id)
);

-- Offering comments
CREATE TABLE IF NOT EXISTS offering_comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_nodes_user_status ON nodes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_offerings_node ON offerings(node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offerings_execution_mode ON offerings(execution_mode, logical_model, enabled, review_status);
CREATE INDEX IF NOT EXISTS idx_node_tokens_user ON node_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_offering_votes_offering ON offering_votes(offering_id);
CREATE INDEX IF NOT EXISTS idx_offering_favorites_offering ON offering_favorites(offering_id);
CREATE INDEX IF NOT EXISTS idx_offering_comments_offering ON offering_comments(offering_id);
CREATE INDEX IF NOT EXISTS idx_user_connection_pool_offering ON user_connection_pool(offering_id);
