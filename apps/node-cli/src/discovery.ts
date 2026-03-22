// ── Model discovery ──────────────────────────────────────────────────

import type { NodeCapability } from '@xllmapi/shared-types';
import type { ProviderConfig } from './config.js';

/**
 * Discover available models from all configured providers.
 * Populates each provider's `models` array as a side effect.
 */
export async function discoverModels(providers: ProviderConfig[]): Promise<NodeCapability[]> {
  const capabilities: NodeCapability[] = [];

  for (const provider of providers) {
    try {
      const models = await discoverProviderModels(provider);
      provider.models = models;

      for (const model of models) {
        capabilities.push({
          realModel: model,
          providerType: provider.type,
          maxConcurrency: 4,
          baseUrl: provider.baseUrl,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[discovery] Failed to discover models for ${provider.type} (${provider.baseUrl}): ${msg}`);
    }
  }

  return capabilities;
}

async function discoverProviderModels(provider: ProviderConfig): Promise<string[]> {
  switch (provider.type) {
    case 'ollama':
      return discoverOllamaModels(provider);
    case 'vllm':
      return discoverOpenAICompatibleModels(provider);
    case 'openai_compatible':
      return discoverOpenAICompatibleModels(provider);
    case 'anthropic':
      return discoverAnthropicModels(provider);
    default:
      return [];
  }
}

async function discoverOllamaModels(provider: ProviderConfig): Promise<string[]> {
  const baseUrl = provider.baseUrl ?? 'http://localhost:11434';
  const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });

  if (!resp.ok) {
    throw new Error(`Ollama /api/tags returned ${resp.status}`);
  }

  const data = await resp.json() as { models?: Array<{ name: string }> };
  if (!data.models || !Array.isArray(data.models)) {
    return [];
  }

  return data.models.map(m => m.name);
}

async function discoverOpenAICompatibleModels(provider: ProviderConfig): Promise<string[]> {
  const baseUrl = provider.baseUrl ?? 'http://localhost:8000';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }

  const resp = await fetch(`${baseUrl}/v1/models`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`/v1/models returned ${resp.status}`);
  }

  const data = await resp.json() as { data?: Array<{ id: string }> };
  if (!data.data || !Array.isArray(data.data)) {
    return [];
  }

  return data.data.map(m => m.id);
}

async function discoverAnthropicModels(_provider: ProviderConfig): Promise<string[]> {
  // Anthropic does not expose a list-models endpoint publicly.
  // Return commonly available models as defaults.
  return [
    'claude-sonnet-4-20250514',
    'claude-3-5-haiku-20241022',
    'claude-opus-4-20250514',
  ];
}
