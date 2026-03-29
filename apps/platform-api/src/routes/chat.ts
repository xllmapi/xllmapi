import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type {
  PublicChatCompletionsRequest,
  CandidateOffering
} from "@xllmapi/shared-types";
import { stripThinking, trimToContextWindow } from "@xllmapi/core";
import { cacheService } from "../cache.js";
import { config } from "../config.js";
import { executeStreamingRequest } from "../core/provider-executor.js";
import { routeRequest, recordRouteResult } from "../core/router.js";
import {
  json,
  read_json,
  authenticate_session_only_,
  unauthorized_,
  has_legacy_model_prefix_,
  get_request_ip_,
  type CreateConversationBody,
  type StreamConversationBody
} from "../lib/http.js";
import { metricsService } from "../metrics.js";
import { platformService } from "../services/platform-service.js";

export async function handleChatRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  if (req.method === "GET" && url.pathname === "/v1/chat/conversations") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = json(200, {
        requestId,
        object: "list",
        data: []
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const logicalModel = url.searchParams.get("model")?.trim() || "";
    if (logicalModel && has_legacy_model_prefix_(logicalModel)) {
      const response = json(400, { error: { code: "invalid_model_name", message: "legacy model prefix xllm/ is no longer supported", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const response = json(200, {
      requestId,
      object: "list",
      data: await platformService.listChatConversations({
        ownerUserId: auth.userId,
        logicalModel,
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100
      })
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/conversations") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<CreateConversationBody>(req);
    if (!body.model) {
      const response = json(400, { error: { message: "model is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    if (has_legacy_model_prefix_(body.model)) {
      const response = json(400, { error: { code: "invalid_model_name", message: "legacy model prefix xllm/ is no longer supported", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const created = await platformService.createChatConversation({
      id: `conv_${randomUUID().replaceAll("-", "")}`,
      ownerUserId: auth.userId,
      logicalModel: body.model.trim(),
      title: body.title?.trim() || undefined
    });
    const response = json(201, { requestId, data: created });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const deleteConversationMatch = req.method === "DELETE"
    ? url.pathname.match(/^\/v1\/chat\/conversations\/([^/]+)$/)
    : null;
  if (deleteConversationMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const conversationId = decodeURIComponent(deleteConversationMatch[1]);
    await platformService.deleteChatConversation({
      conversationId,
      ownerUserId: auth.userId
    });
    const response = json(200, { requestId, deleted: true });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const patchConversationMatch = req.method === "PATCH"
    ? url.pathname.match(/^\/v1\/chat\/conversations\/([^/]+)$/)
    : null;
  if (patchConversationMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const conversationId = decodeURIComponent(patchConversationMatch[1]);
    const body = await read_json<{ title: string }>(req);
    if (!body.title?.trim()) {
      const response = json(400, { error: { message: "title is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const updated = await platformService.updateChatConversationTitle({
      conversationId,
      ownerUserId: auth.userId,
      title: body.title.trim()
    });
    const response = json(200, { requestId, data: updated });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const conversationMessagesMatch = req.method === "GET"
    ? url.pathname.match(/^\/v1\/chat\/conversations\/([^/]+)\/messages$/)
    : null;
  if (conversationMessagesMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = json(200, { requestId, object: "list", data: [] });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const conversationId = decodeURIComponent(conversationMessagesMatch[1]);
    const limit = Number(url.searchParams.get("limit") ?? 500);
    const response = json(200, {
      requestId,
      object: "list",
      data: await platformService.listChatMessages({
        ownerUserId: auth.userId,
        conversationId,
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 2000) : 500
      })
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const conversationStreamMatch = req.method === "POST"
    ? url.pathname.match(/^\/v1\/chat\/conversations\/([^/]+)\/stream$/)
    : null;
  if (conversationStreamMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const conversationId = decodeURIComponent(conversationStreamMatch[1]);
    const conversation = await platformService.getChatConversation({
      ownerUserId: auth.userId,
      conversationId
    });
    if (!conversation) {
      const response = json(404, { error: { message: "conversation not found", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<StreamConversationBody>(req);
    if (!body.content?.trim()) {
      const response = json(400, { error: { message: "content is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const logicalModel = String(conversation.logicalModel ?? "");
    if (has_legacy_model_prefix_(logicalModel)) {
      const response = json(400, { error: { code: "invalid_model_name", message: "legacy model prefix xllm/ is no longer supported", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    metricsService.increment("chatRequests");
    const chatRateLimitStr = await platformService.getConfigValue("chat_rate_limit_per_minute");
    const chatRateLimit = chatRateLimitStr ? Number(chatRateLimitStr) : config.chatRateLimitPerMinute;
    const rateLimit = await cacheService.consumeRateLimit({
      key: `chat:session:${auth.userId}`,
      limit: chatRateLimit,
      windowMs: 60_000
    });
    if (!rateLimit.ok) {
      metricsService.increment("rateLimitHits");
      const response = json(429, {
        error: {
          message: "chat rate limit exceeded",
          requestId,
          resetAt: new Date(rateLimit.resetAt).toISOString()
        }
      });
      res.writeHead(response.statusCode, {
        ...response.headers,
        "x-ratelimit-limit": String(chatRateLimit),
        "x-ratelimit-remaining": String(rateLimit.remaining),
        "x-ratelimit-reset": String(rateLimit.resetAt),
      });
      res.end(response.payload);
      return true;
    }

    const walletBalance = await platformService.getWallet(auth.userId);
    if (walletBalance <= 0) {
      const response = json(402, { error: { message: "insufficient token credit", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const history = await platformService.listChatMessages({
      ownerUserId: auth.userId,
      conversationId,
      limit: 2000
    });

    await platformService.appendChatMessage({
      id: `msg_${randomUUID().replaceAll("-", "")}`,
      conversationId,
      role: "user",
      content: body.content.trim()
    });

    if (!conversation.title && history.length === 0) {
      const userContent = body.content.trim();
      let autoTitle = userContent;
      if (autoTitle.length > 50) {
        autoTitle = autoTitle.slice(0, 50);
        const lastSpace = autoTitle.lastIndexOf(" ");
        if (lastSpace > 0) {
          autoTitle = autoTitle.slice(0, lastSpace);
        }
        autoTitle += "...";
      }
      await platformService.updateChatConversationTitle({
        conversationId,
        ownerUserId: auth.userId,
        title: autoTitle
      });
    }

    // Build messages with context window management
    // Strip thinking from assistant messages before sending to LLM (DB keeps full content)
    const allMessages = [
      ...history.map((item: { role: "system" | "user" | "assistant"; content: string }) => ({
        role: item.role,
        content: item.role === 'assistant' ? stripThinking(item.content) : item.content
      })),
      { role: "user" as const, content: body.content.trim() }
    ].filter(m => m.content); // Remove empty messages after stripping
    const contextMessages = trimToContextWindow(allMessages, logicalModel);

    const mappedBody: PublicChatCompletionsRequest = {
      model: logicalModel,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      stream: true,
      messages: contextMessages
    };
    const messageCount = history.length + 1;

    let route: Awaited<ReturnType<typeof routeRequest>>;
    try {
      route = await routeRequest({
        logicalModel,
        userId: auth.userId,
        conversationId,
        requestId,
        messageCount
      });
    } catch {
      const response = json(404, { error: { message: `no offering available for ${logicalModel}`, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    console.log(`[chat-stream] requestId=${requestId} → ${route.offering.offeringId} (${route.affinityLevel})`);

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });

    try {
      const result = await executeStreamingRequest({
        requestId,
        offerings: route.candidates,
        preferredOfferingId: route.offering.offeringId,
        messages: mappedBody.messages,
        temperature: mappedBody.temperature,
        maxTokens: mappedBody.max_tokens,
        clientUserAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        onSseWrite: (chunk) => { res.write(chunk); }
      });

      recordRouteResult({
        success: true,
        conversationId,
        userId: auth.userId,
        logicalModel,
        offeringId: route.offering.offeringId,
        messageCount,
        latencyMs: result.timing.totalMs
      });

      console.log(`[chat-stream] completed offering=${result.chosenOffering.offeringId} (${route.affinityLevel}) usage=${JSON.stringify(result.usage)}`);

      try {
        await platformService.recordChatSettlement({
          requestId,
          requesterUserId: auth.userId,
          supplierUserId: result.chosenOffering.ownerUserId,
          logicalModel,
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
          providerLabel: result.chosenOffering.providerLabel,
        });
      } catch (err) {
        metricsService.increment("settlementFailures");
        try {
          await platformService.recordSettlementFailure({
            requestId,
            requesterUserId: auth.userId,
            supplierUserId: result.chosenOffering.ownerUserId,
            logicalModel,
            offeringId: result.chosenOffering.offeringId,
            provider: result.chosenOffering.providerType,
            realModel: result.chosenOffering.realModel,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
            fixedPricePer1kInput: result.chosenOffering.fixedPricePer1kInput ?? 0,
            fixedPricePer1kOutput: result.chosenOffering.fixedPricePer1kOutput ?? 0,
            responseBody: mappedBody,
            errorMessage: err instanceof Error ? err.message : String(err)
          });
        } catch (failureRecordErr) {
          console.error(`[chat-stream] settlement failure record error:`, failureRecordErr);
        }
        console.error(`[chat-stream] settlement FAILED:`, err);
      }

      await platformService.appendChatMessage({
        id: `msg_${randomUUID().replaceAll("-", "")}`,
        conversationId,
        role: "assistant",
        content: result.content || "",
        requestId
      });
    } catch (err) {
      recordRouteResult({
        success: false,
        conversationId,
        userId: auth.userId,
        logicalModel,
        offeringId: route.offering.offeringId,
        messageCount,
        latencyMs: 0
      });
      const errorMsg = err instanceof Error ? err.message : "provider execution failed";
      console.error(`[chat-stream] provider execution failed:`, errorMsg);
      // Record failed request for admin visibility
      try {
        await platformService.recordFailedRequest({
          requestId,
          requesterUserId: auth.userId,
          logicalModel,
          offeringId: route.offering.offeringId,
          provider: route.offering.providerType,
          realModel: route.offering.realModel,
          errorMessage: errorMsg,
          clientIp: get_request_ip_(req),
          clientUserAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
          providerLabel: route.offering.providerLabel,
        });
      } catch { /* best-effort */ }
      res.write(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`);
    } finally {
      route.release();
    }

    res.end();
    return true;
  }

  // /v1/chat/completions and /v1/messages moved to api-proxy.ts

  return false;
}
