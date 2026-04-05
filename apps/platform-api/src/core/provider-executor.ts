import type { CandidateOffering, ChatMessage, CustomHeadersConfig } from "@xllmapi/shared-types";
import { decryptSecret } from "../crypto-utils.js";
import { formatApiError } from "../lib/errors.js";
import { metricsService } from "../metrics.js";
import {
  isAvailable,
  recordSuccess,
  recordFailure,
  checkAutoDisable,
  ConcurrencyLimiter,
  withRetry,
  streamOpenAI,
  callOpenAI,
  streamAnthropic,
  callAnthropic,
  type ErrorClass,
  parseRawUsage,
  mergeUsage,
  ZERO_USAGE,
} from "@xllmapi/core";

const limiter = new ConcurrencyLimiter(32);

/** Classify HTTP error into circuit breaker error class */
export function classifyError(status: number, body: string): ErrorClass {
  if (status === 401) return "fatal";
  if (status === 403) {
    if (body.includes("usage limit") || body.includes("quota") || body.includes("billing")) return "degraded";
    if (body.includes("only available for") || body.includes("access_terminated")) return "fatal";
    return "degraded";
  }
  return "transient"; // 429, 5xx, network errors
}

// ── Default proxy User-Agent (from platform_config, cached 60s) ──
let _cachedDefaultUA: string | null = null;
let _cachedDefaultUAAt = 0;
const DEFAULT_UA_CACHE_MS = 60_000;
const FALLBACK_UA = "xllmapi/1.0";

async function getDefaultProxyUA(): Promise<string> {
  if (_cachedDefaultUA && Date.now() - _cachedDefaultUAAt < DEFAULT_UA_CACHE_MS) {
    return _cachedDefaultUA;
  }
  try {
    const { platformService } = await import('../services/platform-service.js');
    const val = await platformService.getConfigValue("default_proxy_user_agent");
    _cachedDefaultUA = (val && typeof val === "string" && val.trim()) ? val.trim() : FALLBACK_UA;
  } catch {
    _cachedDefaultUA = FALLBACK_UA;
  }
  _cachedDefaultUAAt = Date.now();
  return _cachedDefaultUA;
}

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

export interface FailedAttempt {
  offeringId: string;
  error: string;
  errorClass: string;
}

export interface ProviderResult {
  chosenOffering: CandidateOffering;
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
  timing: { totalMs: number };
  finishReason: string;
  upstreamUserAgent?: string;
  failedAttempts?: FailedAttempt[];
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
import { getAdapter, getAdapterForProvider, convertRequestBody, convertJsonResponse, createStreamConverter } from "./adapters/index.js";

/** Check if an offering has an endpoint for a given format */
function hasEndpoint(offering: CandidateOffering, format: ApiFormatId): boolean {
  if (format === "anthropic") {
    return !!offering.anthropicBaseUrl || offering.providerType === "anthropic";
  }
  // OpenAI: needs an explicit baseUrl
  return !!offering.baseUrl;
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
  if (offering.baseUrl) {
    return { targetFormat: "openai", baseUrl: offering.baseUrl };
  }
  // No OpenAI endpoint — use Anthropic with format conversion
  if (offering.anthropicBaseUrl) {
    return { targetFormat: "anthropic", baseUrl: offering.anthropicBaseUrl };
  }
  if (offering.providerType === "anthropic") {
    return { targetFormat: "anthropic", baseUrl: resolveBaseUrl(offering) };
  }
  // Final fallback
  return { targetFormat: "openai", baseUrl: resolveBaseUrl(offering) };
}

// ── Upstream header resolution ──

/** Check if a User-Agent looks like a coding agent (not a browser) */
function isCodingAgentUA(ua: string): boolean {
  // Browsers send Mozilla/5.0... or similar long UA strings
  // Coding agents send short identifiers like "claude-code/1.0", "roo-code/1.2", "kilo-code/1.0"
  return !ua.startsWith("Mozilla/") && !ua.includes("AppleWebKit") && !ua.includes("Chrome/");
}

export function resolveUpstreamHeaders(
  adapterHeaders: Record<string, string>,
  customHeaders: CustomHeadersConfig | undefined,
  clientUserAgent?: string
): Record<string, string> {
  const headers = { ...adapterHeaders };
  const agentUA = clientUserAgent && isCodingAgentUA(clientUserAgent) ? clientUserAgent : undefined;

  // No config: default to transparent passthrough of coding agent UA
  if (!customHeaders) {
    if (agentUA) headers["user-agent"] = agentUA;
    return headers;
  }

  // Apply per-header rules
  if (customHeaders.headers) {
    for (const [name, rule] of Object.entries(customHeaders.headers)) {
      const resolvedValue = rule.value === "$CLIENT_USER_AGENT"
        ? (agentUA ?? "claude-code/1.0")
        : rule.value;

      if (rule.mode === "force") {
        headers[name] = resolvedValue;
      } else if (rule.mode === "fallback") {
        // Use coding agent UA if available, otherwise use configured fallback
        const clientValue = name === "user-agent" ? agentUA : undefined;
        headers[name] = clientValue || resolvedValue;
      }
    }
  }

  // Passthrough: forward coding agent UA if not already handled by a rule
  if (customHeaders.passthrough !== false && agentUA && !customHeaders.headers?.["user-agent"]) {
    headers["user-agent"] = agentUA;
  }

  // Auth mode: convert x-api-key to Authorization: Bearer for providers that require it
  if (customHeaders.authMode === "bearer" && headers["x-api-key"]) {
    headers["authorization"] = `Bearer ${headers["x-api-key"]}`;
    delete headers["x-api-key"];
  }

  return headers;
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
  clientUserAgent?: string;
  signal?: AbortSignal;
  writeHead: (status: number, headers: Record<string, string>) => void;
  res: import("node:http").ServerResponse;
}): Promise<{ chosenOffering: CandidateOffering; usage: ProxyUsage; upstreamUserAgent?: string; failedAttempts?: FailedAttempt[]; targetFormat?: string; timing?: { totalMs: number; ttfbMs: number } }> {
  const available = params.offerings.filter((o) => isAvailable(o.offeringId));
  const candidates = available.length > 0 ? available : params.offerings;
  const isStreaming = params.body.stream === true;
  const defaultUA = await getDefaultProxyUA();
  const failedAttempts: FailedAttempt[] = [];

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
    const startTime = Date.now();
    let ttfbMs = 0;
    try {
      const apiKey = resolveApiKey(offering);

      // Determine target format and base URL
      const { targetFormat, baseUrl } = resolveEndpoint(offering, params.clientFormat);
      const adapter = getAdapterForProvider(targetFormat, offering.providerLabel, offering.compatMode);

      // Build request
      const url = adapter.buildUrl(baseUrl);
      const headers = resolveUpstreamHeaders(
        adapter.buildHeaders(apiKey, defaultUA),
        offering.customHeaders,
        params.clientUserAgent
      );

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

      ttfbMs = Date.now() - startTime;

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        const errClass = classifyError(resp.status, errText);
        recordFailure(offering.offeringId, errClass, errText);
        metricsService.increment("providerErrors");
        checkAutoDisable(offering.offeringId);
        failedAttempts.push({ offeringId: offering.offeringId, error: `${resp.status}: ${errText.slice(0, 200)}`, errorClass: errClass });
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
      if (resp.headers.get("retry-after")) {
        respHeaders["retry-after"] = resp.headers.get("retry-after")!;
      }

      let usage: ProxyUsage = { ...ZERO_USAGE };
      const needsConversion = params.clientFormat !== targetFormat;
      if (needsConversion) {
        respHeaders["x-xllmapi-format-converted"] = `${targetFormat}->${params.clientFormat}`;
      }

      if (isStreaming && resp.body) {
        if (needsConversion && params.clientFormat === "anthropic") {
          respHeaders["content-type"] = "text/event-stream; charset=utf-8";
        }
        params.writeHead(resp.status, respHeaders);

        // Use auto-detect converter: handles providers that return unexpected SSE formats
        // (e.g. Kimi returning Anthropic SSE on OpenAI endpoint)
        const converter = createStreamConverter(targetFormat, params.clientFormat, { autoDetect: true });
        const { Readable } = await import("node:stream");
        const nodeStream = Readable.fromWeb(resp.body as import("stream/web").ReadableStream);
        const TAIL_SIZE = 4096;
        let tailBuf = "";
        // Capture Anthropic message_start usage early (before tail buffer truncates it)
        let earlyUsage: ProxyUsage = { ...ZERO_USAGE };

        await new Promise<void>((resolve, reject) => {
          nodeStream.on("data", (chunk: Buffer) => {
            const str = chunk.toString();
            const lines = converter.transform(str);
            for (const line of lines) params.res.write(line);
            // Capture usage from Anthropic message_start before tail buffer overflow
            // Uses adapter.extractUsageFromJson to apply provider hooks (e.g. Kimi Code fix)
            if (earlyUsage.totalTokens === 0 && str.includes('"message_start"')) {
              try {
                for (const rawLine of str.split("\n")) {
                  const trimmed = rawLine.trim();
                  if (!trimmed.startsWith("data:")) continue;
                  const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
                  const parsed = JSON.parse(jsonStr);
                  if (parsed.type === "message_start" && parsed.message?.usage) {
                    earlyUsage = adapter.extractUsageFromJson({ usage: parsed.message.usage }) ?? earlyUsage;
                  }
                }
              } catch { /* ignore parse errors */ }
            }
            tailBuf += str;
            if (tailBuf.length > TAIL_SIZE * 2) tailBuf = tailBuf.slice(-TAIL_SIZE);
          });
          nodeStream.on("end", () => {
            const final = converter.flush();
            for (const line of final) params.res.write(line);
            params.res.end();
            resolve();
          });
          nodeStream.on("error", (err: Error) => { params.res.end(); reject(err); });
        });

        const tailUsage = adapter.extractUsageFromStream(tailBuf);
        if (tailUsage) {
          // Adapter processed the full tail buffer (authoritative) — use it directly
          usage = tailUsage;
        } else {
          // Tail buffer lost data — fallback to early-captured usage
          usage = earlyUsage;
        }
      } else {
        const bodyText = await resp.text();
        if (needsConversion) {
          try {
            const parsed = JSON.parse(bodyText);
            usage = adapter.extractUsageFromJson(parsed) ?? usage;
            const converted = convertJsonResponse(targetFormat, params.clientFormat, parsed);
            respHeaders["content-type"] = "application/json";
            params.writeHead(resp.status, respHeaders);
            params.res.end(JSON.stringify(converted));
          } catch {
            // Fallback: pass through if conversion fails
            params.writeHead(resp.status, respHeaders);
            params.res.end(bodyText);
          }
        } else {
          params.writeHead(resp.status, respHeaders);
          params.res.end(bodyText);
          try {
            const parsed = JSON.parse(bodyText);
            usage = adapter.extractUsageFromJson(parsed) ?? usage;
          } catch { /* ignore */ }
        }
      }

      // Warn when usage is zero for a successful response — may indicate billing gap
      if (usage.totalTokens === 0) {
        console.warn(`[proxy] WARNING: zero usage for offering=${offering.offeringId} provider=${offering.providerType} model=${offering.realModel} streaming=${isStreaming} — upstream may not report token usage`);
      }

      const totalMs = Date.now() - startTime;
      return { chosenOffering: offering, usage, upstreamUserAgent: headers["user-agent"], failedAttempts: failedAttempts.length > 0 ? failedAttempts : undefined, targetFormat, timing: { totalMs, ttfbMs } };
    } catch (err) {
      recordFailure(offering.offeringId, "transient", err instanceof Error ? err.message : "");
      metricsService.increment("providerErrors");
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
  preferredOfferingId?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  clientUserAgent?: string;
  signal?: AbortSignal;
  onSseWrite: (chunk: string) => void;
}): Promise<ProviderResult> {
  const available = params.offerings.filter((o) => isAvailable(o.offeringId));
  const candidates = available.length > 0 ? available : params.offerings;
  const defaultUA = await getDefaultProxyUA();

  // Preferred offering first, then shuffle rest
  const ordered = params.preferredOfferingId
    ? [
        ...candidates.filter(o => o.offeringId === params.preferredOfferingId),
        ...candidates.filter(o => o.offeringId !== params.preferredOfferingId).sort(() => Math.random() - 0.5),
      ]
    : [...candidates].sort(() => Math.random() - 0.5);

  const failedAttempts: FailedAttempt[] = [];
  let lastError: unknown;
  for (const offering of ordered) {
    // Check daily token limit
    if (offering.dailyTokenLimit && offering.dailyTokenLimit > 0) {
      const exceeded = await isDailyLimitExceeded(offering.offeringId, offering.dailyTokenLimit);
      if (exceeded) {
        console.log(`[provider-executor] offering=${offering.offeringId} daily token limit exceeded, skipping`);
        metricsService.increment("dailyLimitExhausted");
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

        // Resolve custom headers for node dispatch
        const nodeExtraHeaders = resolveUpstreamHeaders(
          { "user-agent": defaultUA },
          offering.customHeaders,
          params.clientUserAgent
        );

        const nodeResult = await nodeConnectionManager.dispatch(
          offering.nodeId,
          params.requestId,
          {
            model: offering.realModel,
            messages: params.messages,
            temperature: params.temperature,
            maxTokens: params.maxTokens,
            stream: true,
            extraHeaders: nodeExtraHeaders,
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
          upstreamUserAgent: nodeExtraHeaders["user-agent"],
          failedAttempts: failedAttempts.length > 0 ? failedAttempts : undefined,
        };
      }

      const apiKey = resolveApiKey(offering);
      const baseUrl = resolveBaseUrl(offering);
      const isAnthropic = offering.providerType === "anthropic";

      // Resolve custom headers for this offering
      const baseHeaders: Record<string, string> = { "user-agent": defaultUA };
      const extraHeaders = resolveUpstreamHeaders(baseHeaders, offering.customHeaders, params.clientUserAgent);
      // Pass all resolved headers as extraHeaders to core functions (overrides their hardcoded defaults)
      const extraHeadersForCore: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraHeaders)) {
        if (k !== "content-type" && k !== "authorization" && k !== "x-api-key" && k !== "anthropic-version") {
          extraHeadersForCore[k] = v;
        }
      }
      const hasExtraHeaders = Object.keys(extraHeadersForCore).length > 0;

      const result = await withRetry(
        async () => {
          if (isAnthropic) {
            return streamAnthropic({
              apiKey,
              model: offering.realModel,
              messages: params.messages,
              temperature: params.temperature,
              maxTokens: params.maxTokens,
              extraHeaders: hasExtraHeaders ? extraHeadersForCore : undefined,
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
              extraHeaders: hasExtraHeaders ? extraHeadersForCore : undefined,
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
        finishReason: result.finishReason,
        upstreamUserAgent: extraHeaders["user-agent"],
        failedAttempts: failedAttempts.length > 0 ? failedAttempts : undefined,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Parse "provider returned {status}: {body}" to classify
      const statusMatch = errMsg.match(/returned (\d+):/);
      const errClass = statusMatch ? classifyError(Number(statusMatch[1]), errMsg) : "transient";
      recordFailure(offering.offeringId, errClass, errMsg);
      metricsService.increment("providerErrors");
      checkAutoDisable(offering.offeringId);
      failedAttempts.push({ offeringId: offering.offeringId, error: errMsg.slice(0, 200), errorClass: errClass });
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
        metricsService.increment("dailyLimitExhausted");
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
      const errMsg = err instanceof Error ? err.message : String(err);
      const statusMatch = errMsg.match(/returned (\d+):/);
      const errClass = statusMatch ? classifyError(Number(statusMatch[1]), errMsg) : "transient";
      recordFailure(offering.offeringId, errClass, errMsg);
      metricsService.increment("providerErrors");
      checkAutoDisable(offering.offeringId);
      lastError = err;
      console.error(`[provider-executor] offering=${offering.offeringId} provider=${offering.providerType} error:`, err);
    } finally {
      releaseSlot(offering.offeringId);
      release();
    }
  }

  throw lastError ?? new Error("all offerings failed");
}
