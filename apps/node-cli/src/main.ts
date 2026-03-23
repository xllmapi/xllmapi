#!/usr/bin/env node
// ── xllmapi-node CLI entry point ────────────────────────────────────

import type { NodeConfig, ProviderConfig } from './config.js';
import { WsClient } from './ws-client.js';

const VERSION = '0.1.0';
const DEFAULT_PLATFORM_URL = 'ws://localhost:3000/ws/node';

// ── Built-in provider presets ─────────────────────────────────────

interface ProviderPreset {
  name: string;
  type: ProviderConfig['type'];
  baseUrl: string;
  description: string;
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    name: 'DeepSeek',
    type: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com',
    description: 'DeepSeek (deepseek-chat, deepseek-reasoner)',
  },
  kimi: {
    name: 'Kimi / Moonshot',
    type: 'openai_compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    description: 'Kimi (moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k)',
  },
  minimax: {
    name: 'MiniMax',
    type: 'openai_compatible',
    baseUrl: 'https://api.minimax.chat/v1',
    description: 'MiniMax (MiniMax-M2.5, MiniMax-M2.7, MiniMax-Text-01)',
  },
  openai: {
    name: 'OpenAI',
    type: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    description: 'OpenAI (gpt-4o, gpt-4o-mini)',
  },
  anthropic: {
    name: 'Anthropic',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    description: 'Anthropic (claude-sonnet, claude-opus)',
  },
  ollama: {
    name: 'Ollama (本地)',
    type: 'ollama',
    baseUrl: 'http://localhost:11434',
    description: 'Ollama 本地模型',
  },
};

// ── Help ──────────────────────────────────────────────────────────

function printUsage(): void {
  const presetList = Object.entries(PROVIDER_PRESETS)
    .map(([key, p]) => `    ${key.padEnd(12)} ${p.description}`)
    .join('\n');

  console.log(`
xllmapi-node v${VERSION} — 分布式 LLM 节点

用法:
  xllmapi-node --token <ntok_xxx> --provider <preset> --api-key <key>

必填:
  --token <token>         节点认证令牌 (ntok_xxx)
  --provider <preset>     供应商名称 (见下方预设列表) 或 openai_compatible
  --api-key <key>         供应商 API Key

可选:
  --platform-url <url>    平台 WS 地址 (默认: ${DEFAULT_PLATFORM_URL})
  --base-url <url>        自定义 API 地址 (覆盖预设)
  --local-ollama <url>    Ollama 地址 (默认: http://localhost:11434)
  --local-vllm <url>      vLLM 地址
  --help                  显示帮助

内置供应商预设:
${presetList}

示例:
  # DeepSeek (只需 token + provider + api-key)
  xllmapi-node --token ntok_xxx --provider deepseek --api-key sk-xxx

  # Kimi / Moonshot
  xllmapi-node --token ntok_xxx --provider kimi --api-key sk-xxx

  # MiniMax
  xllmapi-node --token ntok_xxx --provider minimax --api-key sk-xxx

  # 本地 Ollama
  xllmapi-node --token ntok_xxx --provider ollama

  # 自定义 OpenAI 兼容 API
  xllmapi-node --token ntok_xxx --provider openai_compatible --api-key sk-xxx --base-url https://custom.api.com/v1
`);
}

// ── Parse args ────────────────────────────────────────────────────

function parseArgs(argv: string[]): NodeConfig {
  let token: string | undefined;
  let platformUrl = DEFAULT_PLATFORM_URL;
  let providerName: string | undefined;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  let localOllama: string | undefined;
  let localVllm: string | undefined;

  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token': token = args[++i]; break;
      case '--platform-url': platformUrl = args[++i]; break;
      case '--provider': providerName = args[++i]; break;
      case '--api-key': apiKey = args[++i]; break;
      case '--base-url': baseUrl = args[++i]; break;
      case '--local-ollama': localOllama = args[++i]; break;
      case '--local-vllm': localVllm = args[++i]; break;
      case '--help': case '-h': printUsage(); process.exit(0); break;
      case 'start': break; // ignore legacy "start" subcommand
      default:
        console.error(`未知参数: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!token) {
    console.error('错误: --token 是必填项');
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

  if (providerName) {
    const preset = PROVIDER_PRESETS[providerName.toLowerCase()];
    if (preset) {
      // Use preset
      providers.push({
        type: preset.type,
        apiKey,
        baseUrl: baseUrl ?? preset.baseUrl,
      });
      console.log(`[config] 使用预设: ${preset.name} (${preset.baseUrl})`);
    } else {
      // Custom provider type
      const validTypes = ['openai_compatible', 'anthropic', 'ollama', 'vllm'] as const;
      if (!validTypes.includes(providerName as typeof validTypes[number])) {
        console.error(`错误: 未知的供应商 "${providerName}"`);
        console.error(`可用预设: ${Object.keys(PROVIDER_PRESETS).join(', ')}`);
        console.error(`或使用: ${validTypes.join(', ')}`);
        process.exit(1);
      }
      if (!baseUrl && providerName !== 'ollama' && providerName !== 'vllm') {
        console.error(`错误: 自定义供应商需要 --base-url`);
        process.exit(1);
      }
      providers.push({
        type: providerName as ProviderConfig['type'],
        apiKey,
        baseUrl: baseUrl ?? (providerName === 'anthropic' ? 'https://api.anthropic.com' : undefined),
      });
    }
  }

  // Default to ollama if nothing specified and --local-ollama not set
  if (providers.length === 0) {
    console.error('错误: 请指定供应商。');
    console.error(`示例: --provider deepseek --api-key sk-xxx`);
    console.error(`或:   --provider ollama`);
    process.exit(1);
  }

  return { token, platformUrl, providers };
}

// ── Main ─────────────────────────────────────────────────────────────

const config = parseArgs(process.argv);

console.log(`\nxllmapi-node v${VERSION}`);
console.log(`平台: ${config.platformUrl}`);
console.log(`供应商: ${config.providers.map(p => `${p.type}${p.baseUrl ? ` (${p.baseUrl})` : ''}`).join(', ')}`);
console.log('');

const client = new WsClient(config);
client.connect();

// Graceful shutdown
function handleShutdown(): void {
  console.log('\n[node] 正在关闭...');
  client.shutdown();
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
