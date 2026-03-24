// ── Model discovery ──────────────────────────────────────────────────

import type { NodeCapability } from '@xllmapi/shared-types';
import type { ProviderConfig } from './config.js';

/**
 * Discover available models from all configured providers.
 * Populates each provider's `models` array as a side effect.
 */
/** Model info returned from provider discovery */
interface DiscoveredModel {
  id: string;
  contextLength?: number;
}

export async function discoverModels(providers: ProviderConfig[]): Promise<NodeCapability[]> {
  const capabilities: NodeCapability[] = [];

  for (const provider of providers) {
    try {
      const discovered = await discoverProviderModels(provider);
      provider.models = discovered.map(m => m.id);

      for (const model of discovered) {
        capabilities.push({
          realModel: model.id,
          providerType: provider.type,
          maxConcurrency: 4,
          contextLength: model.contextLength,
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

async function discoverProviderModels(provider: ProviderConfig): Promise<DiscoveredModel[]> {
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

async function discoverOllamaModels(provider: ProviderConfig): Promise<DiscoveredModel[]> {
  const baseUrl = provider.baseUrl ?? 'http://localhost:11434';
  const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });

  if (!resp.ok) {
    throw new Error(`Ollama /api/tags returned ${resp.status}`);
  }

  const data = await resp.json() as { models?: Array<{ name: string }> };
  if (!data.models || !Array.isArray(data.models)) {
    return [];
  }

  return data.models.map(m => ({ id: m.name }));
}

async function discoverOpenAICompatibleModels(provider: ProviderConfig): Promise<DiscoveredModel[]> {
  const baseUrl = (provider.baseUrl ?? 'http://localhost:8000').replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }

  // If baseUrl already ends with /v1, don't add /v1 again
  const modelsUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
  const resp = await fetch(modelsUrl, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`/v1/models returned ${resp.status}`);
  }

  const data = await resp.json() as { data?: Array<{ id: string; context_length?: number }> };
  if (!data.data || !Array.isArray(data.data)) {
    return [];
  }

  return data.data.map(m => ({
    id: m.id,
    contextLength: typeof m.context_length === 'number' ? m.context_length : undefined,
  }));
}

async function discoverAnthropicModels(_provider: ProviderConfig): Promise<DiscoveredModel[]> {
  // Anthropic does not expose a list-models endpoint publicly.
  // Return commonly available models as defaults.
  return [
    { id: 'claude-sonnet-4-20250514', contextLength: 200_000 },
    { id: 'claude-3-5-haiku-20241022', contextLength: 200_000 },
    { id: 'claude-opus-4-20250514', contextLength: 200_000 },
  ];
}
