CREATE TABLE IF NOT EXISTS provider_presets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  anthropic_base_url TEXT,
  models JSONB NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

INSERT INTO provider_presets (id, label, provider_type, base_url, anthropic_base_url, models, sort_order) VALUES
('deepseek', 'DeepSeek', 'openai_compatible', 'https://api.deepseek.com', NULL, '[{"logicalModel":"deepseek-chat","realModel":"deepseek-chat","contextLength":128000,"maxOutputTokens":8192},{"logicalModel":"deepseek-reasoner","realModel":"deepseek-reasoner","contextLength":128000,"maxOutputTokens":64000}]', 1),
('minimax', 'MiniMax', 'openai_compatible', 'https://api.minimaxi.com/v1', 'https://api.minimaxi.com/anthropic', '[{"logicalModel":"MiniMax-M2.7","realModel":"MiniMax-M2.7","contextLength":204800,"maxOutputTokens":16000},{"logicalModel":"MiniMax-M2.5","realModel":"MiniMax-M2.5","contextLength":204800,"maxOutputTokens":16000}]', 2),
('kimi-coding', 'Kimi Coding', 'openai_compatible', 'https://api.kimi.com/coding/v1', NULL, '[{"logicalModel":"kimi-for-coding","realModel":"kimi-for-coding","contextLength":256000,"maxOutputTokens":8192}]', 3),
('kimi', 'Kimi / Moonshot', 'openai_compatible', 'https://api.moonshot.ai/v1', NULL, '[{"logicalModel":"moonshot-v1-8k","realModel":"moonshot-v1-8k","contextLength":8000,"maxOutputTokens":4096},{"logicalModel":"moonshot-v1-32k","realModel":"moonshot-v1-32k","contextLength":32000,"maxOutputTokens":4096}]', 4),
('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', NULL, '[{"logicalModel":"gpt-4o","realModel":"gpt-4o","contextLength":128000,"maxOutputTokens":16384},{"logicalModel":"gpt-4o-mini","realModel":"gpt-4o-mini","contextLength":128000,"maxOutputTokens":16384}]', 5),
('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com/v1', NULL, '[{"logicalModel":"claude-sonnet-4-20250514","realModel":"claude-sonnet-4-20250514","contextLength":200000,"maxOutputTokens":8192}]', 6)
ON CONFLICT (id) DO NOTHING;
