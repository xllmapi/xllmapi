// ── Node CLI configuration types ─────────────────────────────────────

export interface NodeConfig {
  token: string;
  platformUrl: string;
  providers: ProviderConfig[];
}

export interface ProviderConfig {
  type: 'openai_compatible' | 'anthropic' | 'ollama' | 'vllm';
  apiKey?: string;
  baseUrl?: string;
  models?: string[];  // Populated after discovery
}
