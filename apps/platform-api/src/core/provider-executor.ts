import type { CandidateOffering, ChatMessage } from "@xllmapi/shared-types";
import { decryptSecret } from "../crypto-utils.js";
import * as circuitBreaker from "./circuit-breaker.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { withRetry } from "./retry.js";
import { streamOpenAI, callOpenAI } from "./providers/openai.js";
import { streamAnthropic, callAnthropic } from "./providers/anthropic.js";

const limiter = new ConcurrencyLimiter(32);

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
  const available = params.offerings.filter((o) => circuitBreaker.isAvailable(o.offeringId));
  const candidates = available.length > 0 ? available : params.offerings;

  // Shuffle for balanced routing
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);

  let lastError: unknown;
  for (const offering of shuffled) {
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

        circuitBreaker.recordSuccess(offering.offeringId);

        // Send completed event
        const completedEvent = {
          requestId: params.requestId,
          executionId: `exec_${params.requestId}`,
          chosenOfferingId: offering.offeringId,
          fallbackUsed: offering !== shuffled[0],
          provider: 'node',
          realModel: offering.realModel,
          usage: nodeResult.usage,
          timing: {
            routeMs: 0,
            providerLatencyMs: Date.now() - startTime,
            totalMs: Date.now() - startTime
          }
        };
        params.onSseWrite(`event: completed\ndata: ${JSON.stringify(completedEvent)}\n\n`);
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

      circuitBreaker.recordSuccess(offering.offeringId);

      // Send completed event
      const completedEvent = {
        requestId: params.requestId,
        executionId: `exec_${params.requestId}`,
        chosenOfferingId: offering.offeringId,
        fallbackUsed: offering !== shuffled[0],
        provider: offering.providerType,
        realModel: offering.realModel,
        usage: result.usage,
        timing: {
          routeMs: 0,
          providerLatencyMs: Date.now() - startTime,
          totalMs: Date.now() - startTime
        }
      };
      params.onSseWrite(`event: completed\ndata: ${JSON.stringify(completedEvent)}\n\n`);
      params.onSseWrite("data: [DONE]\n\n");

      return {
        chosenOffering: offering,
        content: result.content,
        usage: result.usage,
        timing: { totalMs: Date.now() - startTime },
        finishReason: result.finishReason
      };
    } catch (err) {
      circuitBreaker.recordFailure(offering.offeringId);
      lastError = err;
      console.error(`[provider-executor] offering=${offering.offeringId} provider=${offering.providerType} error:`, err);
      // Try next offering
    } finally {
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
  const available = params.offerings.filter((o) => circuitBreaker.isAvailable(o.offeringId));
  const candidates = available.length > 0 ? available : params.offerings;
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);

  let lastError: unknown;
  for (const offering of shuffled) {
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

        circuitBreaker.recordSuccess(offering.offeringId);

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

      circuitBreaker.recordSuccess(offering.offeringId);

      return {
        chosenOffering: offering,
        content: result.content,
        usage: result.usage,
        timing: { totalMs: Date.now() - startTime },
        finishReason: result.finishReason
      };
    } catch (err) {
      circuitBreaker.recordFailure(offering.offeringId);
      lastError = err;
      console.error(`[provider-executor] offering=${offering.offeringId} provider=${offering.providerType} error:`, err);
    } finally {
      release();
    }
  }

  throw lastError ?? new Error("all offerings failed");
}
