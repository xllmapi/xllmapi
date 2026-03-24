-- Add anthropic_base_url to support providers with multiple API format endpoints
-- e.g., MiniMax has OpenAI endpoint (api.minimaxi.com/v1) AND Anthropic endpoint (api.minimax.io/anthropic/v1)
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS anthropic_base_url TEXT;
