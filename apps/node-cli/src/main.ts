#!/usr/bin/env node
// ── xllmapi-node CLI entry point ────────────────────────────────────

import type { NodeConfig, ProviderConfig } from './config.js';
import { WsClient } from './ws-client.js';

const VERSION = '0.1.0';

function printUsage(): void {
  console.log(`
xllmapi-node v${VERSION} — Distributed LLM node for xllmapi

Usage:
  xllmapi-node --token <ntok_xxx> [options]

Required:
  --token <token>         Node authentication token (ntok_xxx)

Options:
  --platform-url <url>    Platform WS endpoint (default: ws://localhost:3000/ws/node)
  --provider <type>       Provider type: openai_compatible, anthropic, ollama, vllm
  --api-key <key>         API key for the provider
  --base-url <url>        Base URL for the provider API
  --local-ollama <url>    Ollama endpoint (e.g., http://localhost:11434)
  --local-vllm <url>      vLLM endpoint (e.g., http://localhost:8000)
  --help                  Show this help message

Examples:
  # Connect with local Ollama
  xllmapi-node --token ntok_abc123 --local-ollama http://localhost:11434

  # Connect with remote OpenAI-compatible provider
  xllmapi-node --token ntok_abc123 --provider openai_compatible --api-key sk-xxx --base-url https://api.openai.com

  # Connect with Anthropic
  xllmapi-node --token ntok_abc123 --provider anthropic --api-key sk-ant-xxx
`);
}

function parseArgs(argv: string[]): NodeConfig {
  let token: string | undefined;
  let platformUrl = 'ws://localhost:3000/ws/node';
  let providerType: string | undefined;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  let localOllama: string | undefined;
  let localVllm: string | undefined;

  const args = argv.slice(2); // skip node and script path

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token':
        token = args[++i];
        break;
      case '--platform-url':
        platformUrl = args[++i];
        break;
      case '--provider':
        providerType = args[++i];
        break;
      case '--api-key':
        apiKey = args[++i];
        break;
      case '--base-url':
        baseUrl = args[++i];
        break;
      case '--local-ollama':
        localOllama = args[++i];
        break;
      case '--local-vllm':
        localVllm = args[++i];
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!token) {
    console.error('Error: --token is required');
    printUsage();
    process.exit(1);
  }

  // Build provider list
  const providers: ProviderConfig[] = [];

  if (localOllama) {
    providers.push({ type: 'ollama', baseUrl: localOllama });
  }

  if (localVllm) {
    providers.push({ type: 'vllm', baseUrl: localVllm });
  }

  if (providerType) {
    const validTypes = ['openai_compatible', 'anthropic', 'ollama', 'vllm'] as const;
    if (!validTypes.includes(providerType as typeof validTypes[number])) {
      console.error(`Error: Invalid provider type "${providerType}". Must be one of: ${validTypes.join(', ')}`);
      process.exit(1);
    }
    providers.push({
      type: providerType as ProviderConfig['type'],
      apiKey,
      baseUrl: baseUrl ?? (providerType === 'anthropic' ? 'https://api.anthropic.com' : undefined),
    });
  }

  if (providers.length === 0) {
    console.error('Error: At least one provider must be specified.');
    console.error('Use --provider, --local-ollama, or --local-vllm to configure a provider.');
    process.exit(1);
  }

  return { token, platformUrl, providers };
}

// ── Main ─────────────────────────────────────────────────────────────

const config = parseArgs(process.argv);

console.log(`xllmapi-node v${VERSION}`);
console.log(`Connecting to: ${config.platformUrl}`);
console.log(`Providers: ${config.providers.map(p => p.type).join(', ')}`);
console.log('');

const client = new WsClient(config);
client.connect();

// Graceful shutdown
function handleShutdown(): void {
  console.log('\n[node] Shutting down...');
  client.shutdown();
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
