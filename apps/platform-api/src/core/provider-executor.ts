import type { CandidateOffering, ChatMessage } from "@xllmapi/shared-types";
import { decryptSecret } from "../crypto-utils.js";
import {
  isAvailable,
  recordSuccess,
  recordFailure,
  ConcurrencyLimiter,
  withRetry,
  streamOpenAI,
  callOpenAI,
  streamAnthropic,
  callAnthropic,
} from "@xllmapi/core";

const limiter = new ConcurrencyLimiter(32);

// ── Per-offering concurrency tracking ──
const activeConcurrency = new Map<string, number>();

function acquireSlot(offeringId: string, maxConcurrency: number): boolean {
  if (maxConcurrency <= 0) return true; // no limit
  const current = activeConcurrency.get(offeringId) ?? 0;
  if (current >= maxConcurrency) return false;
  activeConcurrency.set(offeringId, current + 1);
  return true;
}

function releaseSlot(offeringId: string) {
  const current = activeConcurrency.get(offeringId) ?? 0;
  if (current > 0) activeConcurrency.set(offeringId, current - 1);
}

// ── Daily token limit check ──
async function isDailyLimitExceeded(offeringId: string, dailyTokenLimit: number): Promise<boolean> {
  if (dailyTokenLimit <= 0) return false;
  try {
    const { platformService } = await import('../services/platform-service.js');
    const used = await platformService.getOfferingDailyTokenUsage(offeringId);
    return used >= dailyTokenLimit;
  } catch {
    // If check fails, allow the request to proceed
    return false;
  }
}

export interface ProviderResult {
  chosenOffering: CandidateOffering;
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  timing: { totalMs: number };
  finishReason: string;
}

function resolveApiKey(offering: CandidateOffering): string {
  if (offering.encryptedSecret) {
    return decryptSecret(offering.encryptedSecret);
  }
  if (offering.apiKeyEnvName) {
    const envVal = process.env[offering.apiKeyEnvName];
    if (envVal) return envVal;
  }
  throw new Error(`no API key available for offering ${offering.offeringId}`);
}

function resolveBaseUrl(offering: CandidateOffering): string {
  if (offering.baseUrl) return offering.baseUrl;
  switch (offering.providerType) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com";
    default:
      return "https://api.openai.com/v1";
  }
}

/**
 * Proxy an OpenAI-compatible API request to the best available offering.
 * Transparently forwards the entire request body (including tools, tool_choice, etc.)
 * and pipes the provider's raw response back to the client.
 * This is the "API layer" — no message transformation, no stripping, no wrapping.
 */
export async function proxyApiRequest(params: {
  requestId: string;
  offerings: CandidateOffering[];
  /** Raw request body from client — forwarded as-is to provider (with model swapped) */
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onResponse: (status: number, headers: Record<string, string>, body: ReadableStream<Uint8Array> | string) => void;
}): Promise<{ chosenOffering: CandidateOffering; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }> {
  const available = params.offerings.filter((o) => isAvailable(o.offeringId));
  const candidates = available.length > 0 ? available : params.offerings;
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);

  let lastError: unknown;
  for (const offering of shuffled) {
    if (offering.dailyTokenLimit && offering.dailyTokenLimit > 0) {
      const exceeded = await isDailyLimitExceeded(offering.offeringId, offering.dailyTokenLimit);
      if (exceeded) continue;
    }
    if (!acquireSlot(offering.offeringId, offering.maxConcurrency ?? 0)) continue;

    const release = await limiter.acquire();
    try {
      const apiKey = resolveApiKey(offering);
      const rawBase = resolveBaseUrl(offering);
      const base = rawBase.replace(/\/+$/, "");
      const url = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

      // Build provider body: swap model, clamp max_tokens, keep everything else
      const providerBody: Record<string, unknown> = { ...params.body, model: offering.realModel };
      if (typeof providerBody.max_tokens === "number") {
        providerBody.max_tokens = Math.min(providerBody.max_tokens as number, 8192);
      }

      const headers: Record<string, string> = {
        "content-type": "application/json",
        "user-agent": "xllmapi/1.0",
      };
      if (offering.providerType === "anthropic") {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
      } else {
        headers["authorization"] = `Bearer ${apiKey}`;
      }

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(providerBody),
        signal: params.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        recordFailure(offering.offeringId);
        lastError = new Error(`provider returned ${resp.status}: ${errText}`);
        continue;
      }

      recordSuccess(offering.offeringId);

      // Pipe response headers + body back to client
      const respHeaders: Record<string, string> = {
        "content-type": resp.headers.get("content-type") ?? "application/json",
      };
      if (resp.headers.get("cache-control")) {
        respHeaders["cache-control"] = resp.headers.get("cache-control")!;
      }

      if (resp.body) {
        params.onResponse(resp.status, respHeaders, resp.body);
      } else {
        const text = await resp.text();
        params.onResponse(resp.status, respHeaders, text);
      }

      return { chosenOffering: offering };
    } catch (err) {
      recordFailure(offering.offeringId);
      lastError = err;
      console.error(`[proxy] offering=${offering.offeringId} error:`, err);
    } finally {
      releaseSlot(offering.offeringId);
      release();
    }
  }

  throw lastError ?? new Error("all offerings failed");
}

/**
 * Execute a streaming chat request against the best available offering.
 * Handles circuit breaking, retry with fallback, concurrency limiting.
 * Writes SSE events directly to the client via onSseWrite callback.
 */
export async function executeStreamingRequest(params: {
  requestId: string;
  offerings: CandidateOffering[];
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onSseWrite: (chunk: string) => void;
}): Promise<ProviderResult> {
  const available = params.offerings.filter((o) => isAvailable(o.offeringId));
  const candidates = available.length > 0 ? available : params.offerings;

  // Shuffle for balanced routing
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);

  let lastError: unknown;
  for (const offering of shuffled) {
    // Check daily token limit
    if (offering.dailyTokenLimit && offering.dailyTokenLimit > 0) {
      const exceeded = await isDailyLimitExceeded(offering.offeringId, offering.dailyTokenLimit);
      if (exceeded) {
        console.log(`[provider-executor] offering=${offering.offeringId} daily token limit exceeded, skipping`);
        continue;
      }
    }

    // Check per-offering concurrency limit
    if (!acquireSlot(offering.offeringId, offering.maxConcurrency ?? 0)) {
      console.log(`[provider-executor] offering=${offering.offeringId} max concurrency reached, skipping`);
      continue;
    }

    const release = await limiter.acquire();
    const startTime = Date.now();
    try {
      // Check if this is a node-backed offering
      if (offering.executionMode === 'node' && offering.nodeId) {
        const { nodeConnectionManager } = await import('./node-connection-manager.js');
        if (!nodeConnectionManager.isNodeOnline(offering.nodeId)) {
          throw new Error('Node is offline');
        }

        const nodeResult = await nodeConnectionManager.dispatch(
          offering.nodeId,
          params.requestId,
          {
            model: offering.realModel,
            messages: params.messages,
            temperature: params.temperature,
            maxTokens: params.maxTokens,
            stream: true,
          },
          params.onSseWrite
        );

        recordSuccess(offering.offeringId);

        // Send OpenAI-compatible finish + usage chunks
        const nodeFinishChunk = {
          id: `exec_${params.requestId}`,
          object: "chat.completion.chunk",
          model: offering.realModel,
          choices: [{ index: 0, delta: {}, finish_reason: nodeResult.finishReason || "stop" }]
        };
        params.onSseWrite(`data: ${JSON.stringify(nodeFinishChunk)}\n\n`);

        if (nodeResult.usage.totalTokens > 0) {
          const nodeUsageChunk = {
            id: `exec_${params.requestId}`,
            object: "chat.completion.chunk",
            model: offering.realModel,
            choices: [],
            usage: {
              prompt_tokens: nodeResult.usage.inputTokens,
              completion_tokens: nodeResult.usage.outputTokens,
              total_tokens: nodeResult.usage.totalTokens
            }
          };
          params.onSseWrite(`data: ${JSON.stringify(nodeUsageChunk)}\n\n`);
        }
        params.onSseWrite("data: [DONE]\n\n");

        return {
          chosenOffering: offering,
          content: nodeResult.content,
          usage: nodeResult.usage,
          timing: { totalMs: Date.now() - startTime },
          finishReason: nodeResult.finishReason,
        };
      }

      const apiKey = resolveApiKey(offering);
      const baseUrl = resolveBaseUrl(offering);
      const isAnthropic = offering.providerType === "anthropic";

      const result = await withRetry(
        async () => {
          if (isAnthropic) {
            return streamAnthropic({
              apiKey,
              model: offering.realModel,
              messages: params.messages,
              temperature: params.temperature,
              maxTokens: params.maxTokens,
              signal: params.signal,
              onDelta(text) {
                // Write OpenAI-compatible SSE format to client
                const chunk = {
                  choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
                };
                params.onSseWrite(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            });
          } else {
            return streamOpenAI({
              baseUrl,
              apiKey,
              model: offering.realModel,
              messages: params.messages,
              temperature: params.temperature,
              maxTokens: params.maxTokens,
              signal: params.signal,
              onDelta(text) {
                const chunk = {
                  choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
                };
                params.onSseWrite(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            });
          }
        },
        { signal: params.signal }
      );

      recordSuccess(offering.offeringId);

      // Send OpenAI-compatible finish + usage chunks
      const finishChunk = {
        id: `exec_${params.requestId}`,
        object: "chat.completion.chunk",
        model: offering.realModel,
        choices: [{ index: 0, delta: {}, finish_reason: result.finishReason || "stop" }]
      };
      params.onSseWrite(`data: ${JSON.stringify(finishChunk)}\n\n`);

      if (result.usage.totalTokens > 0) {
        const usageChunk = {
          id: `exec_${params.requestId}`,
          object: "chat.completion.chunk",
          model: offering.realModel,
          choices: [],
          usage: {
            prompt_tokens: result.usage.inputTokens,
            completion_tokens: result.usage.outputTokens,
            total_tokens: result.usage.totalTokens
          }
        };
        params.onSseWrite(`data: ${JSON.stringify(usageChunk)}\n\n`);
      }
      params.onSseWrite("data: [DONE]\n\n");

      return {
        chosenOffering: offering,
        content: result.content,
        usage: result.usage,
        timing: { totalMs: Date.now() - startTime },
        finishReason: result.finishReason
      };
    } catch (err) {
      recordFailure(offering.offeringId);
      lastError = err;
      console.error(`[provider-executor] offering=${offering.offeringId} provider=${offering.providerType} error:`, err);
      // Try next offering
    } finally {
      releaseSlot(offering.offeringId);
      release();
    }
  }

  throw lastError ?? new Error("all offerings failed");
}

/**
 * Execute a non-streaming chat request.
 */
export async function executeRequest(params: {
  requestId: string;
  offerings: CandidateOffering[];
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<ProviderResult> {
  const available = params.offerings.filter((o) => isAvailable(o.offeringId));
  const candidates = available.length > 0 ? available : params.offerings;
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);

  let lastError: unknown;
  for (const offering of shuffled) {
    // Check daily token limit
    if (offering.dailyTokenLimit && offering.dailyTokenLimit > 0) {
      const exceeded = await isDailyLimitExceeded(offering.offeringId, offering.dailyTokenLimit);
      if (exceeded) {
        console.log(`[provider-executor] offering=${offering.offeringId} daily token limit exceeded, skipping`);
        continue;
      }
    }

    // Check per-offering concurrency limit
    if (!acquireSlot(offering.offeringId, offering.maxConcurrency ?? 0)) {
      console.log(`[provider-executor] offering=${offering.offeringId} max concurrency reached, skipping`);
      continue;
    }

    const release = await limiter.acquire();
    const startTime = Date.now();
    try {
      // Check if this is a node-backed offering
      if (offering.executionMode === 'node' && offering.nodeId) {
        const { nodeConnectionManager } = await import('./node-connection-manager.js');
        if (!nodeConnectionManager.isNodeOnline(offering.nodeId)) {
          throw new Error('Node is offline');
        }

        const nodeResult = await nodeConnectionManager.dispatch(
          offering.nodeId,
          params.requestId,
          {
            model: offering.realModel,
            messages: params.messages,
            temperature: params.temperature,
            maxTokens: params.maxTokens,
            stream: false,
          },
        );

        recordSuccess(offering.offeringId);

        return {
          chosenOffering: offering,
          content: nodeResult.content,
          usage: nodeResult.usage,
          timing: { totalMs: Date.now() - startTime },
          finishReason: nodeResult.finishReason,
        };
      }

      const apiKey = resolveApiKey(offering);
      const baseUrl = resolveBaseUrl(offering);
      const isAnthropic = offering.providerType === "anthropic";

      const result = await withRetry(
        async () => {
          if (isAnthropic) {
            return callAnthropic({
              apiKey,
              model: offering.realModel,
              messages: params.messages,
              temperature: params.temperature,
              maxTokens: params.maxTokens,
              signal: params.signal
            });
          } else {
            return callOpenAI({
              baseUrl,
              apiKey,
              model: offering.realModel,
              messages: params.messages,
              temperature: params.temperature,
              maxTokens: params.maxTokens,
              signal: params.signal
            });
          }
        },
        { signal: params.signal }
      );

      recordSuccess(offering.offeringId);

      return {
        chosenOffering: offering,
        content: result.content,
        usage: result.usage,
        timing: { totalMs: Date.now() - startTime },
        finishReason: result.finishReason
      };
    } catch (err) {
      recordFailure(offering.offeringId);
      lastError = err;
      console.error(`[provider-executor] offering=${offering.offeringId} provider=${offering.providerType} error:`, err);
    } finally {
      releaseSlot(offering.offeringId);
      release();
    }
  }

  throw lastError ?? new Error("all offerings failed");
}
