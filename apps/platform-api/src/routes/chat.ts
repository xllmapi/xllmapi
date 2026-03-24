import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type {
  PublicChatCompletionsRequest,
  PublicChatCompletionsResponse,
  CandidateOffering
} from "@xllmapi/shared-types";
import { stripThinking, trimToContextWindow } from "@xllmapi/core";
import { cacheService } from "../cache.js";
import { config } from "../config.js";
import { executeStreamingRequest, executeRequest } from "../core/provider-executor.js";
import {
  json,
  read_json,
  authenticate_request_,
  authenticate_session_only_,
  unauthorized_,
  has_legacy_model_prefix_,
  type CreateConversationBody,
  type StreamConversationBody
} from "../lib/http.js";
import { metricsService } from "../metrics.js";
import { platformService } from "../services/platform-service.js";

/**
 * Fetch offerings for a model, including node-backed offerings.
 * Node offerings are mapped to CandidateOffering shape with executionMode/nodeId.
 * If includeNodes is false, only platform offerings are returned.
 *
 * When userId is provided, tries the user's usage list (offering_favorites) first.
 * Falls back to all offerings if the user's list is empty (backward compat).
 */
async function findOfferingsIncludingNodes(
  logicalModel: string,
  includeNodes: boolean,
  userId?: string
): Promise<CandidateOffering[]> {
  let offerings: CandidateOffering[];

  // If userId is available, check user's usage list
  if (userId) {
    // Check if user has ANY items in usage list (not just for this model)
    const allUserOfferings = await platformService.listConnectionPool(userId);
    if (allUserOfferings.length > 0) {
      // User has a usage list — only route to models in their list
      offerings = await platformService.findUserOfferingsForModel(userId, logicalModel);
    } else {
      // No usage list at all — fallback to all offerings for backward compat
      offerings = await getAllOfferings(logicalModel, includeNodes);
    }
  } else {
    offerings = await getAllOfferings(logicalModel, includeNodes);
  }

  // Apply user's max price config if set
  if (userId) {
    const config = await platformService.getUserModelConfig(userId, logicalModel);
    if (config) {
      offerings = offerings.filter((o: CandidateOffering) => {
        if (config.maxInputPrice != null && (o.fixedPricePer1kInput ?? 0) > config.maxInputPrice) return false;
        if (config.maxOutputPrice != null && (o.fixedPricePer1kOutput ?? 0) > config.maxOutputPrice) return false;
        return true;
      });
    }
  }

  return offerings;
}

async function getAllOfferings(
  logicalModel: string,
  includeNodes: boolean
): Promise<CandidateOffering[]> {
  const platformOfferings = await platformService.findOfferingsForModel(logicalModel);

  if (!includeNodes) {
    // Filter out any node offerings that might have been returned
    return platformOfferings.filter(
      (o: CandidateOffering) => o.executionMode !== 'node'
    );
  }

  // Fetch node offerings and map to CandidateOffering shape
  const nodeOfferings = await platformService.findOfferingsForModelWithNodes({
    logicalModel,
  });

  const mappedNodeOfferings: CandidateOffering[] = nodeOfferings.map((no: any) => ({
    offeringId: no.id ?? no.offeringId,
    ownerUserId: no.ownerUserId,
    providerType: 'openai_compatible' as const,
    credentialId: '',
    realModel: no.realModel,
    pricingMode: no.pricingMode ?? 'fixed',
    fixedPricePer1kInput: no.fixedPricePer1kInput,
    fixedPricePer1kOutput: no.fixedPricePer1kOutput,
    successRate1h: 0.99,
    p95LatencyMs1h: 2000,
    recentErrorRate10m: 0,
    enabled: true,
    executionMode: 'node' as const,
    nodeId: no.nodeId,
  }));

  return [...platformOfferings, ...mappedNodeOfferings];
}

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

    const candidateOfferings = await findOfferingsIncludingNodes(logicalModel, true, auth.userId);
    if (candidateOfferings.length === 0) {
      const response = json(404, { error: { message: `no offering available for ${logicalModel}`, requestId } });
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
    console.log(`[chat-stream] requestId=${requestId} candidateCount=${candidateOfferings.length}`);

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });

    try {
      const result = await executeStreamingRequest({
        requestId,
        offerings: candidateOfferings,
        messages: mappedBody.messages,
        temperature: mappedBody.temperature,
        maxTokens: mappedBody.max_tokens,
        onSseWrite: (chunk) => { res.write(chunk); }
      });

      console.log(`[chat-stream] completed offering=${result.chosenOffering.offeringId} usage=${JSON.stringify(result.usage)}`);

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
          fixedPricePer1kOutput: result.chosenOffering.fixedPricePer1kOutput ?? 0
        });
      } catch (err) {
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
      console.error(`[chat-stream] provider execution failed:`, err);
      const errorMsg = err instanceof Error ? err.message : "provider execution failed";
      res.write(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`);
    }

    res.end();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await read_json<PublicChatCompletionsRequest>(req);
    const auth = await authenticate_request_(req);

    if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
      const response = json(400, {
        error: {
          message: "model and messages are required",
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    if (has_legacy_model_prefix_(body.model)) {
      const response = json(400, {
        error: {
          code: "invalid_model_name",
          message: "legacy model prefix xllm/ is no longer supported",
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    metricsService.increment("chatRequests");
    const authRateLimitId = "apiKeyId" in auth && auth.apiKeyId ? auth.apiKeyId : `session:${auth.userId}`;
    const rateLimit = await cacheService.consumeRateLimit({
      key: `chat:${authRateLimitId}`,
      limit: config.chatRateLimitPerMinute,
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
        "x-ratelimit-limit": String(config.chatRateLimitPerMinute),
        "x-ratelimit-remaining": String(rateLimit.remaining),
        "x-ratelimit-reset": String(rateLimit.resetAt)
      });
      res.end(response.payload);
      return true;
    }

    const requesterUserId = auth.userId;
    const idempotencyKey = typeof req.headers["idempotency-key"] === "string"
      ? req.headers["idempotency-key"].trim()
      : null;

    if (!body.stream && idempotencyKey) {
      const cacheKey = `${requesterUserId}:${idempotencyKey}`;
      const cachedReplay = await cacheService.getCachedResponse(cacheKey);
      if (cachedReplay) {
        metricsService.increment("cacheHits");
        metricsService.increment("idempotentReplays");
        const cachedBody = JSON.parse(cachedReplay.value);
        const response = json(200, cachedBody);
        res.writeHead(response.statusCode, {
          ...response.headers,
          "x-idempotent-replay": "true",
          "x-cache-source": cachedReplay.source
        });
        res.end(response.payload);
        return true;
      }

      const cachedResponse = await platformService.findCachedResponse({
        requesterUserId,
        idempotencyKey
      });
      if (cachedResponse) {
        metricsService.increment("cacheHits");
        metricsService.increment("idempotentReplays");
        const response = json(200, cachedResponse);
        await cacheService.setCachedResponse({
          key: cacheKey,
          value: JSON.stringify(cachedResponse)
        });
        res.writeHead(response.statusCode, {
          ...response.headers,
          "x-idempotent-replay": "true"
        });
        res.end(response.payload);
        return true;
      }

      metricsService.increment("cacheMisses");
    }

    const walletBalance = await platformService.getWallet(requesterUserId);
    if (walletBalance <= 0) {
      const response = json(402, {
        error: {
          message: "insufficient token credit",
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const candidateOfferings = await findOfferingsIncludingNodes(body.model, true, requesterUserId);
    if (candidateOfferings.length === 0) {
      const response = json(404, {
        error: {
          message: `no offering available for ${body.model}`,
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    // Strip thinking from assistant messages before forwarding to LLM
    const cleanedMessages = body.messages
      .map(m => ({
        ...m,
        content: m.role === 'assistant' ? stripThinking(m.content) : m.content
      }))
      .filter(m => m.content);

    if (body.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });

      try {
        const result = await executeStreamingRequest({
          requestId,
          offerings: candidateOfferings,
          messages: cleanedMessages,
          temperature: body.temperature,
          maxTokens: body.max_tokens,
          onSseWrite: (chunk) => { res.write(chunk); }
        });

        await platformService.recordChatSettlement({
          requestId,
          requesterUserId,
          supplierUserId: result.chosenOffering.ownerUserId,
          logicalModel: body.model,
          idempotencyKey,
          offeringId: result.chosenOffering.offeringId,
          provider: result.chosenOffering.providerType,
          realModel: result.chosenOffering.realModel,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          fixedPricePer1kInput: result.chosenOffering.fixedPricePer1kInput ?? 0,
          fixedPricePer1kOutput: result.chosenOffering.fixedPricePer1kOutput ?? 0
        });
      } catch (err) {
        console.error(`[chat/completions stream] error:`, err);
        metricsService.increment("coreErrors");
      }

      res.end();
      return true;
    }

    try {
      const result = await executeRequest({
        requestId,
        offerings: candidateOfferings,
        messages: cleanedMessages,
        temperature: body.temperature,
        maxTokens: body.max_tokens
      });

      await platformService.recordChatSettlement({
        requestId,
        requesterUserId,
        supplierUserId: result.chosenOffering.ownerUserId,
        logicalModel: body.model,
        idempotencyKey,
        offeringId: result.chosenOffering.offeringId,
        provider: result.chosenOffering.providerType,
        realModel: result.chosenOffering.realModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        fixedPricePer1kInput: result.chosenOffering.fixedPricePer1kInput ?? 0,
        fixedPricePer1kOutput: result.chosenOffering.fixedPricePer1kOutput ?? 0
      });

      const publicResponse: PublicChatCompletionsResponse = {
        id: `exec_${requestId}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: result.content },
          finish_reason: "stop"
        }],
        usage: {
          prompt_tokens: result.usage.inputTokens,
          completion_tokens: result.usage.outputTokens,
          total_tokens: result.usage.totalTokens
        },
        route: {
          offering_id: result.chosenOffering.offeringId,
          provider: result.chosenOffering.providerType,
          real_model: result.chosenOffering.realModel,
          fallback_used: false
        }
      };

      const response = json(200, publicResponse);
      if (idempotencyKey) {
        await cacheService.setCachedResponse({
          key: `${requesterUserId}:${idempotencyKey}`,
          value: response.payload
        });
      }
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
    } catch (err) {
      metricsService.increment("coreErrors");
      const errorMsg = err instanceof Error ? err.message : "provider execution failed";
      const response = json(502, { error: { message: errorMsg, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    const auth = await authenticate_request_(req);
    const body = await read_json<{
      model: string;
      messages: Array<{ role: "user" | "assistant"; content: string | Array<{ type: string; text?: string }> }>;
      max_tokens?: number;
    }>(req);

    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const mappedBody: PublicChatCompletionsRequest = {
      model: body.model,
      max_tokens: body.max_tokens,
      messages: (body.messages ?? []).map((message) => ({
        role: message.role,
        content: typeof message.content === "string"
          ? message.content
          : message.content.map((item) => item.text ?? "").join("\n")
      }))
    };
    if (has_legacy_model_prefix_(mappedBody.model)) {
      const response = json(400, {
        error: {
          code: "invalid_model_name",
          message: "legacy model prefix xllm/ is no longer supported",
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const candidateOfferings = await findOfferingsIncludingNodes(mappedBody.model, true, auth.userId);
    if (candidateOfferings.length === 0) {
      const response = json(404, {
        error: { message: `no offering available for ${mappedBody.model}`, requestId }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    try {
      const result = await executeRequest({
        requestId,
        offerings: candidateOfferings,
        messages: mappedBody.messages,
        temperature: mappedBody.temperature,
        maxTokens: mappedBody.max_tokens
      });

      await platformService.recordChatSettlement({
        requestId,
        requesterUserId: auth.userId,
        supplierUserId: result.chosenOffering.ownerUserId,
        logicalModel: mappedBody.model,
        offeringId: result.chosenOffering.offeringId,
        provider: result.chosenOffering.providerType,
        realModel: result.chosenOffering.realModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        fixedPricePer1kInput: result.chosenOffering.fixedPricePer1kInput ?? 0,
        fixedPricePer1kOutput: result.chosenOffering.fixedPricePer1kOutput ?? 0
      });

      const response = json(200, {
        id: `exec_${requestId}`,
        type: "message",
        role: "assistant",
        model: mappedBody.model,
        content: [{ type: "text", text: result.content }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "provider execution failed";
      const response = json(502, { error: { message: errorMsg, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
    }
    return true;
  }

  return false;
}
