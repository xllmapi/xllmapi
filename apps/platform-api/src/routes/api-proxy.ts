/**
 * API Proxy Layer — Multi-format transparent proxy.
 *
 * URL structure:
 *   /v1/chat/completions       → OpenAI compatible (transparent proxy)
 *   /anthropic/v1/messages     → Anthropic compatible (transparent proxy)
 *   /v1/messages               → Anthropic compatible (backward compat alias)
 *   /xllmapi/v1/chat           → xllmapi unified API (auto-detect or x-api-format header)
 *
 * All endpoints: auth → rate limit → wallet → offering selection → proxy → settlement.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import type { CandidateOffering } from "@xllmapi/shared-types";
import type { ApiFormatId } from "../core/adapters/index.js";
import { cacheService } from "../cache.js";
import { config } from "../config.js";
import { proxyApiRequest } from "../core/provider-executor.js";
import { resolveOfferings, recordRouteResult } from "../core/router.js";
import {
  json,
  read_json,
  authenticate_request_,
  unauthorized_,
  get_request_ip_,
} from "../lib/http.js";
import { metricsService } from "../metrics.js";
import { platformService } from "../services/platform-service.js";

// Offering resolution now handled by core/router.ts

// ── Shared pre-check: auth → rate limit → wallet → offerings ────────

async function validateApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
  model: string
): Promise<{ userId: string; offerings: CandidateOffering[]; apiKeyId?: string } | null> {
  const auth = await authenticate_request_(req);
  if (!auth) {
    metricsService.increment("authFailures");
    const response = unauthorized_(requestId);
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return null;
  }

  metricsService.increment("chatRequests");
  const chatRateLimitStr = await platformService.getConfigValue("chat_rate_limit_per_minute");
  const chatRateLimit = chatRateLimitStr ? Number(chatRateLimitStr) : config.chatRateLimitPerMinute;
  const rateLimitKey = "apiKeyId" in auth && auth.apiKeyId ? auth.apiKeyId : `session:${auth.userId}`;
  const rateLimit = await cacheService.consumeRateLimit({
    key: `chat:${rateLimitKey}`,
    limit: chatRateLimit,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    metricsService.increment("rateLimitHits");
    const response = json(429, {
      error: { message: "chat rate limit exceeded", requestId, resetAt: new Date(rateLimit.resetAt).toISOString() },
    });
    res.writeHead(response.statusCode, {
      ...response.headers,
      "x-ratelimit-limit": String(chatRateLimit),
      "x-ratelimit-remaining": String(rateLimit.remaining),
      "x-ratelimit-reset": String(rateLimit.resetAt),
    });
    res.end(response.payload);
    return null;
  }

  const walletBalance = await platformService.getWallet(auth.userId);
  if (walletBalance <= 0) {
    const response = json(402, { error: { message: "insufficient token credit", requestId } });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return null;
  }

  const offerings = await resolveOfferings(model, auth.userId);
  if (offerings.length === 0) {
    try {
      await platformService.recordFailedRequest({
        requestId,
        requesterUserId: auth.userId,
        logicalModel: model,
        errorMessage: `no offering available for ${model}`,
        clientIp: get_request_ip_(req),
        clientUserAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      });
    } catch { /* best-effort */ }
    const response = json(404, { error: { message: `no offering available for ${model}`, requestId } });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return null;
  }

  return { userId: auth.userId, offerings, apiKeyId: "apiKeyId" in auth ? (auth as { apiKeyId?: string }).apiKeyId : undefined };
}

// ── Core proxy + settlement logic ───────────────────────────────────

async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
  body: Record<string, unknown>,
  model: string,
  clientFormat: ApiFormatId,
): Promise<void> {
  const validated = await validateApiRequest(req, res, requestId, model);
  if (!validated) return;

  try {
    const result = await proxyApiRequest({
      requestId,
      offerings: validated.offerings,
      body,
      clientFormat,
      clientUserAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      writeHead: (status, headers) => res.writeHead(status, headers),
      res,
    });

    try {
      await platformService.recordChatSettlement({
        requestId,
        requesterUserId: validated.userId,
        supplierUserId: result.chosenOffering.ownerUserId,
        logicalModel: model,
        offeringId: result.chosenOffering.offeringId,
        provider: result.chosenOffering.providerType,
        realModel: result.chosenOffering.realModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        fixedPricePer1kInput: result.chosenOffering.fixedPricePer1kInput ?? 0,
        fixedPricePer1kOutput: result.chosenOffering.fixedPricePer1kOutput ?? 0,
        clientIp: get_request_ip_(req),
        clientUserAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        upstreamUserAgent: result.upstreamUserAgent,
        apiKeyId: validated.apiKeyId,
        providerLabel: result.chosenOffering.providerLabel,
        responseBody: result.failedAttempts ? { fallbackAttempts: result.failedAttempts } : undefined,
        clientFormat: clientFormat,
        upstreamFormat: result.targetFormat,
        formatConverted: clientFormat !== result.targetFormat,
        latencyTotalMs: result.timing?.totalMs,
        latencyTtfbMs: result.timing?.ttfbMs,
      });
    } catch (settlementErr) {
      metricsService.increment("settlementFailures");
      try {
        await platformService.recordSettlementFailure({
          requestId,
          requesterUserId: validated.userId,
          supplierUserId: result.chosenOffering.ownerUserId,
          logicalModel: model,
          offeringId: result.chosenOffering.offeringId,
          provider: result.chosenOffering.providerType,
          realModel: result.chosenOffering.realModel,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          fixedPricePer1kInput: result.chosenOffering.fixedPricePer1kInput ?? 0,
          fixedPricePer1kOutput: result.chosenOffering.fixedPricePer1kOutput ?? 0,
          responseBody: body,
          errorMessage: settlementErr instanceof Error ? settlementErr.message : String(settlementErr)
        });
      } catch (failureRecordErr) {
        console.error(`[api-proxy] settlement failure record error:`, failureRecordErr);
      }
      console.error(`[api-proxy] settlement error:`, settlementErr);
    }
  } catch (err) {
    metricsService.increment("coreErrors");
    const errorMsg = err instanceof Error ? err.message : "provider execution failed";
    // Record failed request for admin visibility
    try {
      await platformService.recordFailedRequest({
        requestId,
        requesterUserId: validated.userId,
        logicalModel: model,
        errorMessage: errorMsg,
        clientIp: get_request_ip_(req),
        clientUserAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      });
    } catch { /* best-effort */ }
    if (!res.headersSent) {
      const response = json(502, { error: { message: errorMsg, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
    }
  }
}

// ── Auto-detect API format from request body ────────────────────────

function detectApiFormat(body: Record<string, unknown>, headerHint?: string): ApiFormatId {
  // 1. Explicit header override
  if (headerHint === "openai" || headerHint === "anthropic") return headerHint;

  // 2. Body heuristics
  //    Anthropic: has max_tokens (required), no "stream" with choices pattern, has system as top-level
  //    OpenAI: has messages[].role with "system" role in messages, or has "tools"/"functions"
  if (body.system !== undefined) return "anthropic"; // top-level system = Anthropic
  if (body.stop_sequences !== undefined) return "anthropic";

  const messages = body.messages as Array<{ role?: string }> | undefined;
  if (messages?.some(m => m.role === "system")) return "openai"; // system in messages = OpenAI

  // Default: OpenAI (most common)
  return "openai";
}

// ── Route handler ───────────────────────────────────────────────────

export async function handleApiProxyRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  // ── POST /v1/chat/completions — OpenAI compatible ─────────────────
  // ── POST /chat/completions — OpenAI compatible (short form) ───────
  if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
    const body = await read_json<Record<string, unknown>>(req);
    const model = body.model as string | undefined;
    if (!model || !Array.isArray(body.messages) || (body.messages as unknown[]).length === 0) {
      const response = json(400, { error: { message: "model and messages are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    await handleProxyRequest(req, res, requestId, body, model, "openai");
    return true;
  }

  // ── POST /anthropic/v1/messages — Anthropic compatible (primary) ──
  // ── POST /v1/messages — Anthropic compatible (backward compat) ────
  // ── POST /messages — Anthropic compatible (AI SDK @ai-sdk/anthropic) ────
  if (req.method === "POST" && (url.pathname === "/anthropic/v1/messages" || url.pathname === "/v1/messages" || url.pathname === "/messages")) {
    const body = await read_json<Record<string, unknown>>(req);
    const model = body.model as string | undefined;
    if (!model || !Array.isArray(body.messages) || (body.messages as unknown[]).length === 0) {
      const response = json(400, { error: { message: "model and messages are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    await handleProxyRequest(req, res, requestId, body, model, "anthropic");
    return true;
  }

  // ── POST /xllmapi/v1/chat[/completions] — xllmapi unified API ────
  // Auto-detects format from body, or explicit via x-api-format header.
  // Supports both OpenAI and Anthropic request formats.
  // Also handles /xllmapi/v1/messages for Anthropic SDK compatibility.
  if (req.method === "POST" && (
    url.pathname === "/xllmapi/v1/chat" ||
    url.pathname === "/xllmapi/v1/chat/completions" ||
    url.pathname === "/xllmapi/v1/messages"
  )) {
    const body = await read_json<Record<string, unknown>>(req);
    const model = body.model as string | undefined;
    if (!model || !Array.isArray(body.messages) || (body.messages as unknown[]).length === 0) {
      const response = json(400, { error: { message: "model and messages are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const formatHint = typeof req.headers["x-api-format"] === "string"
      ? req.headers["x-api-format"]
      : url.pathname.endsWith("/messages") ? "anthropic" : undefined;
    const clientFormat = detectApiFormat(body, formatHint);

    await handleProxyRequest(req, res, requestId, body, model, clientFormat);
    return true;
  }

  return false;
}
