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

import type { ApiFormatId, ProxyUsage } from "./adapters/index.js";
import { getAdapter, convertRequestBody } from "./adapters/index.js";

/** Check if an offering has an endpoint for a given format */
function hasEndpoint(offering: CandidateOffering, format: ApiFormatId): boolean {
  if (format === "anthropic") {
    return !!offering.anthropicBaseUrl || offering.providerType === "anthropic";
  }
  // OpenAI: any offering with a baseUrl or OpenAI-compatible provider
  return !!offering.baseUrl || offering.providerType !== "anthropic";
}

/** Resolve which format endpoint to use and its base URL */
function resolveEndpoint(offering: CandidateOffering, clientFormat: ApiFormatId): { targetFormat: ApiFormatId; baseUrl: string } {
  // Prefer same-format endpoint
  if (clientFormat === "anthropic") {
    // Try Anthropic endpoint first
    if (offering.anthropicBaseUrl) {
      return { targetFormat: "anthropic", baseUrl: offering.anthropicBaseUrl };
    }
    if (offering.providerType === "anthropic") {
      return { targetFormat: "anthropic", baseUrl: resolveBaseUrl(offering) };
    }
    // Fallback to OpenAI endpoint with format conversion
    return { targetFormat: "openai", baseUrl: resolveBaseUrl(offering) };
  }

  // Client wants OpenAI format
  if (offering.providerType !== "anthropic" || offering.baseUrl) {
    return { targetFormat: "openai", baseUrl: resolveBaseUrl(offering) };
  }
  // Provider only has Anthropic endpoint — convert
  return { targetFormat: "anthropic", baseUrl: resolveBaseUrl(offering) };
}

/**
 * Proxy an API request to the best available offering.
 * Supports OpenAI and Anthropic formats, with automatic format routing:
 * - Same format → transparent proxy (preferred)
 * - Cross format → body conversion + proxy to available endpoint
 *
 * Extracts usage from the response for settlement.
 */
export async function proxyApiRequest(params: {
  requestId: string;
  offerings: CandidateOffering[];
  body: Record<string, unknown>;
  /** Client-side API format: "openai" for /chat/completions, "anthropic" for /messages */
  clientFormat: ApiFormatId;
  signal?: AbortSignal;
  writeHead: (status: number, headers: Record<string, string>) => void;
  res: import("node:http").ServerResponse;
}): Promise<{ chosenOffering: CandidateOffering; usage: ProxyUsage }> {
  const available = params.offerings.filter((o) => isAvailable(o.offeringId));
  const candidates = available.length > 0 ? available : params.offerings;
  const isStreaming = params.body.stream === true;

  // Sort offerings: prefer those with a matching endpoint for the client format
  const sorted = [...candidates].sort((a, b) => {
    const aHas = hasEndpoint(a, params.clientFormat) ? 0 : 1;
    const bHas = hasEndpoint(b, params.clientFormat) ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    return Math.random() - 0.5; // Random among same-priority
  });

  let lastError: unknown;
  let skippedDailyLimit = 0;
  let skippedConcurrency = 0;

  for (const offering of sorted) {
    if (offering.dailyTokenLimit && Number(offering.dailyTokenLimit) > 0) {
      const exceeded = await isDailyLimitExceeded(offering.offeringId, Number(offering.dailyTokenLimit));
      if (exceeded) { skippedDailyLimit++; continue; }
    }
    if (!acquireSlot(offering.offeringId, offering.maxConcurrency ?? 0)) { skippedConcurrency++; continue; }

    const release = await limiter.acquire();
    try {
      const apiKey = resolveApiKey(offering);

      // Determine target format and base URL
      const { targetFormat, baseUrl } = resolveEndpoint(offering, params.clientFormat);
      const adapter = getAdapter(targetFormat);

      // Build request
      const url = adapter.buildUrl(baseUrl);
      const headers = adapter.buildHeaders(apiKey);

      // If client format differs from target, convert the body
      const rawBody = (params.clientFormat === targetFormat)
        ? params.body
        : convertRequestBody(params.clientFormat, targetFormat, params.body);

      const providerBody = adapter.prepareBody(rawBody, offering.realModel);

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

      const respHeaders: Record<string, string> = {
        "content-type": resp.headers.get("content-type") ?? "application/json",
      };
      if (resp.headers.get("cache-control")) {
        respHeaders["cache-control"] = resp.headers.get("cache-control")!;
      }

      let usage: ProxyUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

      if (isStreaming && resp.body) {
        params.writeHead(resp.status, respHeaders);
        const { Readable } = await import("node:stream");
        const nodeStream = Readable.fromWeb(resp.body as import("stream/web").ReadableStream);
        const TAIL_SIZE = 4096;
        let tailBuf = "";

        await new Promise<void>((resolve, reject) => {
          nodeStream.on("data", (chunk: Buffer) => {
            params.res.write(chunk);
            const str = chunk.toString();
            tailBuf += str;
            if (tailBuf.length > TAIL_SIZE * 2) tailBuf = tailBuf.slice(-TAIL_SIZE);
          });
          nodeStream.on("end", () => { params.res.end(); resolve(); });
          nodeStream.on("error", (err: Error) => { params.res.end(); reject(err); });
        });

        usage = adapter.extractUsageFromStream(tailBuf) ?? usage;
      } else {
        const bodyText = await resp.text();
        params.writeHead(resp.status, respHeaders);
        params.res.end(bodyText);

        try {
          const parsed = JSON.parse(bodyText);
          usage = adapter.extractUsageFromJson(parsed) ?? usage;
        } catch { /* ignore */ }
      }

      return { chosenOffering: offering, usage };
    } catch (err) {
      recordFailure(offering.offeringId);
      lastError = err;
      console.error(`[proxy] offering=${offering.offeringId} provider=${offering.providerType} error:`, err instanceof Error ? err.message : err);
    } finally {
      releaseSlot(offering.offeringId);
      release();
    }
  }

  if (!lastError) {
    const reasons: string[] = [];
    if (skippedDailyLimit > 0) reasons.push(`${skippedDailyLimit} offering(s) exceeded daily token limit`);
    if (skippedConcurrency > 0) reasons.push(`${skippedConcurrency} offering(s) at max concurrency`);
    const detail = reasons.length > 0 ? `: ${reasons.join(", ")}` : "";
    throw new Error(`all ${sorted.length} offerings unavailable${detail}`);
  }
  throw lastError;
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
