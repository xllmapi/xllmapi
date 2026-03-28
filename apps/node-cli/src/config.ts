// ── Node CLI configuration types ─────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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

// ── Persistent config (no API Key on disk) ───────────────────────────

export interface SavedConfig {
  platformUrl: string;
  token: string;
  provider: {
    type: ProviderConfig['type'];
    baseUrl?: string;
    presetKey?: string;
  };
}

const CONFIG_DIR = join(homedir(), '.config', 'xllmapi');
const CONFIG_FILE = join(CONFIG_DIR, 'node.json');

export function loadSavedConfig(): SavedConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveConfig(config: SavedConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
