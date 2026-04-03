-- 024: Provider usage semantics for non-standard API behavior
-- Allows per-provider-preset configuration of how usage fields are interpreted
-- 'standard' = standard OpenAI/Anthropic semantics (default)
-- 'input_includes_cached' = input_tokens includes cached tokens (e.g. Kimi Code)
ALTER TABLE provider_presets ADD COLUMN IF NOT EXISTS compat_mode TEXT DEFAULT 'standard';
