#!/usr/bin/env node
// ── xllmapi-node CLI entry point ────────────────────────────────────

import * as readline from 'node:readline';
import type { NodeConfig, ProviderConfig } from './config.js';
import { WsClient } from './ws-client.js';

const VERSION = '0.1.0';
const DEFAULT_PLATFORM_URL = 'ws://localhost:3000/ws/node';

// ── Built-in provider presets ─────────────────────────────────────

interface ProviderPreset {
  key: string;
  name: string;
  type: ProviderConfig['type'];
  baseUrl: string;
  needsKey: boolean;
}

const PRESETS: ProviderPreset[] = [
  { key: 'deepseek', name: 'DeepSeek', type: 'openai_compatible', baseUrl: 'https://api.deepseek.com', needsKey: true },
  { key: 'kimi', name: 'Kimi / Moonshot (通用)', type: 'openai_compatible', baseUrl: 'https://api.moonshot.ai/v1', needsKey: true },
  { key: 'kimi-coding', name: 'Kimi Coding (仅Coding Agent)', type: 'openai_compatible', baseUrl: 'https://api.kimi.com/coding/v1', needsKey: true },
  { key: 'minimax', name: 'MiniMax', type: 'openai_compatible', baseUrl: 'https://api.minimax.chat/v1', needsKey: true },
  { key: 'openai', name: 'OpenAI', type: 'openai_compatible', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { key: 'anthropic', name: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true },
  { key: 'ollama', name: 'Ollama (本地)', type: 'ollama', baseUrl: 'http://localhost:11434', needsKey: false },
  { key: 'custom', name: '自定义 (OpenAI 兼容)', type: 'openai_compatible', baseUrl: '', needsKey: true },
];

// ── TUI helpers ───────────────────────────────────────────────────

function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

// ── Interactive TUI ───────────────────────────────────────────────

async function interactiveTUI(): Promise<NodeConfig> {
  const rl = createRL();

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     xllmapi-node v' + VERSION + '                  ║');
  console.log('║     分布式模型节点                        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Step 1: Platform URL
  const platformInput = await ask(rl, `平台地址 (回车使用默认 ${DEFAULT_PLATFORM_URL}): `);
  const platformUrl = platformInput || DEFAULT_PLATFORM_URL;

  // Step 2: Node token
  console.log('');
  const token = await ask(rl, '节点令牌 (ntok_xxx): ');
  if (!token) {
    console.error('错误: 节点令牌不能为空');
    process.exit(1);
  }

  // Step 3: Choose provider
  console.log('');
  console.log('选择模型供应商:');
  console.log('');
  PRESETS.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name}`);
  });
  console.log('');

  const choiceStr = await ask(rl, `输入编号 (1-${PRESETS.length}): `);
  const choiceIdx = parseInt(choiceStr, 10) - 1;
  if (isNaN(choiceIdx) || choiceIdx < 0 || choiceIdx >= PRESETS.length) {
    console.error('错误: 无效的选择');
    process.exit(1);
  }

  const preset = PRESETS[choiceIdx]!;
  console.log(`\n已选择: ${preset.name}`);

  // Step 4: Base URL (for custom)
  let baseUrl = preset.baseUrl;
  if (preset.key === 'custom') {
    baseUrl = await ask(rl, 'API 地址 (如 https://api.example.com/v1): ');
    if (!baseUrl) {
      console.error('错误: 自定义供应商需要 API 地址');
      process.exit(1);
    }
  }

  // Step 5: API Key
  let apiKey: string | undefined;
  if (preset.needsKey) {
    apiKey = await ask(rl, `${preset.name} API Key: `);
    if (!apiKey) {
      console.error('错误: API Key 不能为空');
      process.exit(1);
    }
  }

  rl.close();

  const providers: ProviderConfig[] = [{
    type: preset.type,
    apiKey,
    baseUrl,
  }];

  return { token, platformUrl, providers };
}

// ── CLI args mode (non-interactive) ───────────────────────────────

function parseArgs(argv: string[]): NodeConfig | null {
  const args = argv.slice(2);

  // If no args or only "start", use interactive mode
  if (args.length === 0 || (args.length === 1 && args[0] === 'start')) {
    return null; // signal to use TUI
  }

  let token: string | undefined;
  let platformUrl = DEFAULT_PLATFORM_URL;
  let providerName: string | undefined;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  let localOllama: string | undefined;
  let localVllm: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token': token = args[++i]; break;
      case '--platform-url': platformUrl = args[++i]; break;
      case '--provider': providerName = args[++i]; break;
      case '--api-key': apiKey = args[++i]; break;
      case '--base-url': baseUrl = args[++i]; break;
      case '--local-ollama': localOllama = args[++i]; break;
      case '--local-vllm': localVllm = args[++i]; break;
      case '--help': case '-h': printHelp(); process.exit(0); break;
      case 'start': break;
      default:
        console.error(`未知参数: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!token) {
    console.error('错误: --token 是必填项');
    process.exit(1);
  }

  const providers: ProviderConfig[] = [];

  if (localOllama) providers.push({ type: 'ollama', baseUrl: localOllama });
  if (localVllm) providers.push({ type: 'vllm', baseUrl: localVllm });

  if (providerName) {
    const preset = PRESETS.find((p) => p.key === providerName!.toLowerCase());
    if (preset) {
      providers.push({ type: preset.type, apiKey, baseUrl: baseUrl ?? preset.baseUrl });
    } else {
      const validTypes = ['openai_compatible', 'anthropic', 'ollama', 'vllm'] as const;
      if (!validTypes.includes(providerName as typeof validTypes[number])) {
        console.error(`未知供应商: ${providerName}`);
        process.exit(1);
      }
      providers.push({
        type: providerName as ProviderConfig['type'],
        apiKey,
        baseUrl: baseUrl ?? (providerName === 'anthropic' ? 'https://api.anthropic.com' : undefined),
      });
    }
  }

  if (providers.length === 0) {
    console.error('错误: 请指定 --provider');
    process.exit(1);
  }

  return { token, platformUrl, providers };
}

function printHelp(): void {
  const presetList = PRESETS.filter((p) => p.key !== 'custom')
    .map((p) => `    ${p.key.padEnd(12)} ${p.name}`)
    .join('\n');

  console.log(`
xllmapi-node v${VERSION} — 分布式模型节点

交互模式 (推荐):
  xllmapi-node              直接运行，按提示操作

命令行模式:
  xllmapi-node --token <ntok_xxx> --provider <name> --api-key <key>

内置供应商:
${presetList}

示例:
  xllmapi-node --token ntok_xxx --provider deepseek --api-key sk-xxx
  xllmapi-node --token ntok_xxx --provider kimi --api-key sk-xxx
  xllmapi-node --token ntok_xxx --provider ollama
`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  let config = parseArgs(process.argv);

  if (!config) {
    // Interactive TUI mode
    config = await interactiveTUI();
  }

  console.log('');
  console.log(`xllmapi-node v${VERSION}`);
  console.log(`平台: ${config.platformUrl}`);
  console.log(`供应商: ${config.providers.map((p) => `${p.type}${p.baseUrl ? ` (${p.baseUrl})` : ''}`).join(', ')}`);
  console.log('');

  const client = new WsClient(config);
  client.connect();

  function handleShutdown(): void {
    console.log('\n[node] 正在关闭...');
    client.shutdown();
    setTimeout(() => process.exit(0), 1000);
  }

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

void main();
