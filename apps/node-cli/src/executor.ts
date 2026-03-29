// ── LLM request executor ─────────────────────────────────────────────

import { createDecipheriv } from 'node:crypto';
import { createLogger } from '@xllmapi/logger';
import type { ProviderConfig } from './config.js';

const log = createLogger({ module: 'executor' });

// Try to load Rust secure-executor (optional dependency)
let secureExecute: ((params: any, onDelta: (delta: string) => void) => Promise<any>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@xllmapi/secure-executor');
  secureExecute = mod.execute;
  log.info('secure-executor loaded (messages will be processed in native module)');
} catch {
  // secure-executor not available — will use JS fallback
}

export interface ExecuteRequestPayload {
  model: string;
  messages?: Array<{ role: string; content: string }>;
  encryptedMessages?: string;
  encryptionKey?: string;
  encryptionIv?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  extraHeaders?: Record<string, string>;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

type OnDelta = (text: string) => void;
type OnDone = (content: string, usage: UsageInfo, finishReason: string) => void;
type OnError = (code: string, message: string) => void;

/**
 * Decrypt messages using Node.js crypto (JS fallback when secure-executor unavailable)
 */
function decryptMessagesJs(encryptedMessages: string, keyB64: string, ivB64: string): Array<{ role: string; content: string }> {
  const key = Buffer.from(keyB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(encryptedMessages, 'base64');
  const authTag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Find the matching provider for a given model and execute the request.
 */
export async function executeRequest(
  payload: ExecuteRequestPayload,
  providers: ProviderConfig[],
  onDelta: OnDelta,
  onDone: OnDone,
  onError: OnError,
): Promise<void> {
  const provider = findProviderForModel(payload.model, providers);
  if (!provider) {
    log.warn('no provider found for model', { model: payload.model });
    onError('MODEL_NOT_FOUND', `No provider configured for model: ${payload.model}`);
    return;
  }

  // Encrypted path + secure-executor available → Rust handles everything (messages never in JS heap)
  if (payload.encryptedMessages && payload.encryptionKey && payload.encryptionIv && secureExecute) {
    try {
      const result = await secureExecute(
        {
          encryptedMessages: payload.encryptedMessages,
          encryptionKey: payload.encryptionKey,
          encryptionIv: payload.encryptionIv,
          providerBaseUrl: provider.baseUrl ?? '',
          providerApiKey: provider.apiKey ?? null,
          providerType: provider.type,
          model: payload.model,
          temperature: payload.temperature ?? null,
          maxTokens: payload.maxTokens ?? null,
        },
        (delta: string) => onDelta(delta),
      );
      onDone(result.content, {
        inputTokens: result.inputTokens ?? result.input_tokens ?? 0,
        outputTokens: result.outputTokens ?? result.output_tokens ?? 0,
        totalTokens: result.totalTokens ?? result.total_tokens ?? 0,
      }, result.finishReason ?? result.finish_reason ?? 'stop');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('secure execution error', { model: payload.model, error: msg });
      onError('EXECUTION_ERROR', msg);
    }
    return;
  }

  // Encrypted path but no secure-executor → JS fallback (decrypt in JS, messages in JS heap)
  let resolvedPayload = payload;
  if (payload.encryptedMessages && payload.encryptionKey && payload.encryptionIv) {
    log.warn('decrypting messages in JS fallback (secure-executor not available)');
    const messages = decryptMessagesJs(payload.encryptedMessages, payload.encryptionKey, payload.encryptionIv);
    resolvedPayload = { ...payload, messages };
  }

  // Unencrypted path / fallback → existing JS logic
  if (!resolvedPayload.messages) {
    onError('MISSING_MESSAGES', 'No messages in payload and decryption failed');
    return;
  }

  try {
    switch (provider.type) {
      case 'anthropic':
        await executeAnthropicRequest(resolvedPayload as ResolvedPayload, provider, onDelta, onDone);
        break;
      case 'openai_compatible':
      case 'ollama':
      case 'vllm':
        await executeOpenAIRequest(resolvedPayload as ResolvedPayload, provider, onDelta, onDone);
        break;
      default:
        onError('UNSUPPORTED_PROVIDER', `Unsupported provider type: ${provider.type}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('execution error', { model: payload.model, provider: provider.type, error: msg });
    onError('EXECUTION_ERROR', msg);
  }
}

function findProviderForModel(model: string, providers: ProviderConfig[]): ProviderConfig | undefined {
  // First try exact match
  for (const p of providers) {
    if (p.models?.includes(model)) return p;
  }
  // For providers without discovered models, try the first provider that could serve it
  for (const p of providers) {
    if (!p.models || p.models.length === 0) return p;
  }
  return undefined;
}

// ── OpenAI-compatible execution (also covers Ollama, vLLM) ──────────

interface ResolvedPayload extends ExecuteRequestPayload {
  messages: Array<{ role: string; content: string }>;
}

async function executeOpenAIRequest(
  payload: ResolvedPayload,
  provider: ProviderConfig,
  onDelta: OnDelta,
  onDone: OnDone,
): Promise<void> {
  const baseUrl = (provider.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
  const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'claude-code/1.0',
    ...payload.extraHeaders,
  };
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }

  const body = JSON.stringify({
    model: payload.model,
    messages: payload.messages,
    temperature: payload.temperature ?? 0.7,
    max_tokens: payload.maxTokens ?? 4096,
    stream: true,
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenAI-compatible API returned ${resp.status}: ${text}`);
  }

  if (!resp.body) {
    throw new Error('Response body is null');
  }

  let fullContent = '';
  let finishReason = 'stop';
  let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let inThinking = false; // Track whether we're inside a <think> block

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Handle both "data: {...}" and "data:{...}" (some providers omit the space)
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5);
      if (data === '[DONE]' || data.trim() === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        const choice = parsed.choices?.[0];
        const contentDelta = choice?.delta?.content;
        const reasoningDelta = choice?.delta?.reasoning_content;

        // Normalize: wrap reasoning_content in <think> tags for frontend
        if (reasoningDelta) {
          if (!inThinking) {
            inThinking = true;
            const prefix = '<think>';
            fullContent += prefix;
            onDelta(prefix);
          }
          fullContent += reasoningDelta;
          onDelta(reasoningDelta);
        }
        if (contentDelta) {
          if (inThinking) {
            inThinking = false;
            const suffix = '</think>';
            fullContent += suffix;
            onDelta(suffix);
          }
          fullContent += contentDelta;
          onDelta(contentDelta);
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
            totalTokens: parsed.usage.total_tokens ?? 0,
          };
        }
      } catch {
        // Skip malformed JSON chunks
      }
    }
  }

  // Close thinking tag if still open
  if (inThinking) {
    const suffix = '</think>';
    fullContent += suffix;
    onDelta(suffix);
  }

  // Estimate usage if not provided by API
  if (usage.totalTokens === 0) {
    usage = estimateUsage(payload.messages, fullContent);
  }

  onDone(fullContent, usage, finishReason);
}

// ── Anthropic execution ─────────────────────────────────────────────

async function executeAnthropicRequest(
  payload: ResolvedPayload,
  provider: ProviderConfig,
  onDelta: OnDelta,
  onDone: OnDone,
): Promise<void> {
  const baseUrl = provider.baseUrl ?? 'https://api.anthropic.com';
  const url = `${baseUrl}/v1/messages`;

  if (!provider.apiKey) {
    throw new Error('Anthropic provider requires an API key');
  }

  // Separate system message from conversation
  const systemMessage = payload.messages.find(m => m.role === 'system');
  const conversationMessages = payload.messages.filter(m => m.role !== 'system');

  const body: Record<string, unknown> = {
    model: payload.model,
    messages: conversationMessages,
    max_tokens: payload.maxTokens ?? 4096,
    stream: true,
  };
  if (payload.temperature !== undefined) {
    body.temperature = payload.temperature;
  }
  if (systemMessage) {
    body.system = systemMessage.content;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Anthropic API returned ${resp.status}: ${text}`);
  }

  if (!resp.body) {
    throw new Error('Response body is null');
  }

  let fullContent = '';
  let finishReason = 'stop';
  let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);

      try {
        const event = JSON.parse(data) as {
          type: string;
          delta?: { type?: string; text?: string; stop_reason?: string };
          usage?: { input_tokens?: number; output_tokens?: number };
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        };

        switch (event.type) {
          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              fullContent += event.delta.text;
              onDelta(event.delta.text);
            }
            break;
          case 'message_delta':
            if (event.delta?.stop_reason) {
              finishReason = event.delta.stop_reason === 'end_turn' ? 'stop' : event.delta.stop_reason;
            }
            if (event.usage) {
              usage.outputTokens = event.usage.output_tokens ?? 0;
            }
            break;
          case 'message_start':
            if (event.message?.usage) {
              usage.inputTokens = event.message.usage.input_tokens ?? 0;
            }
            break;
        }
      } catch {
        // Skip malformed JSON chunks
      }
    }
  }

  usage.totalTokens = usage.inputTokens + usage.outputTokens;

  // Estimate if not provided
  if (usage.totalTokens === 0) {
    usage = estimateUsage(payload.messages, fullContent);
  }

  onDone(fullContent, usage, finishReason);
}

// ── Usage estimation fallback ───────────────────────────────────────

function estimateUsage(
  messages: Array<{ role: string; content: string }>,
  outputContent: string,
): UsageInfo {
  // Rough estimate: ~4 chars per token
  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputContent.length / 4);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}
