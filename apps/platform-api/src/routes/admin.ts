import type { IncomingMessage, ServerResponse } from "node:http";

import { randomUUID } from "node:crypto";

import {
  json,
  read_json,
  authenticate_request_,
  authenticate_session_only_,
  unauthorized_,
  forbidden_,
  match_id_route_,
  type ReviewOfferingBody,
  type InvitationBody
} from "../lib/http.js";
import { metricsService } from "../metrics.js";
import { platformService } from "../services/platform-service.js";
import { platformRepository } from "../repositories/index.js";

export async function handleAdminRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  if (req.method === "GET" && url.pathname === "/v1/admin/offerings/pending") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (auth.role !== "admin") {
      const response = forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, {
      object: "list",
      data: await platformService.listPendingOfferings()
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/invitations/all") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const data = await platformService.getAdminAllInvitations(limit);
    const response = json(200, { object: "list", requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/invitations") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { object: "list", data: await platformService.listAdminInvitations() });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/users") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { object: "list", data: await platformService.listAdminUsers() });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/admin/invitations") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<InvitationBody>(req);
    if (!body.email) {
      const response = json(400, { error: { message: "email is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.createAdminInvitation({
      inviterUserId: auth.userId,
      invitedEmail: body.email,
      note: body.note
    });
    if (!result.ok) {
      const response = json(409, { error: { code: result.code, message: result.message, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(201, { requestId, data: result.data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/usage") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? Number(daysParam) : undefined;
    const response = json(200, { requestId, data: await platformService.getAdminUsageSummary(days) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/usage/recent") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const response = json(200, { requestId, data: await platformService.getAdminUsageRecent(limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/stats") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data: await platformService.getAdminStats() });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "PATCH") {
    const userId = match_id_route_(url.pathname, "/v1/admin/users/");
    if (userId) {
      const auth = await authenticate_session_only_(req);
      if (!auth || auth.role !== "admin") {
        const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      const body = await read_json<{ role?: string; status?: string; walletAdjust?: number }>(req);
      const result = await platformService.updateAdminUser(userId, body);
      const response = json(200, { requestId, data: result });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/providers") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data: await platformService.getAdminProviders() });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/config") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data: await platformService.getAdminConfig() });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/v1/admin/config") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ key: string; value: string }>(req);
    if (!body.key) {
      const response = json(400, { error: { message: "key is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.updateAdminConfig(body.key, body.value, auth.userId);
    const response = json(200, { requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/requests") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? Number(daysParam) : undefined;
    const model = url.searchParams.get("model") || undefined;
    const provider = url.searchParams.get("provider") || undefined;
    const user = url.searchParams.get("user") || undefined;
    const result = await platformService.getAdminRequests({ model, provider, user, days, page, limit });
    const response = json(200, { requestId, ...result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // GET /v1/admin/requests/:id — request detail
  const requestDetailMatch = url.pathname.match(/^\/v1\/admin\/requests\/([^/]+)$/);
  if (req.method === "GET" && requestDetailMatch && url.pathname !== "/v1/admin/requests") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const reqId = decodeURIComponent(requestDetailMatch[1]);
    const detail = await platformRepository.getAdminRequestDetail(reqId);
    if (!detail) {
      const response = json(404, { error: { code: "not_found", message: "request not found", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { ok: true, data: detail, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/settlements") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? Number(daysParam) : undefined;
    const result = await platformService.getAdminSettlements({ days, page, limit });
    const response = json(200, { requestId, ...result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/settlement-failures") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const statusParam = url.searchParams.get("status");
    const status = statusParam === "resolved" || statusParam === "all" ? statusParam : "open";
    const result = await platformService.getAdminSettlementFailures({ page, limit, status });
    const response = json(200, { requestId, ...result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const settlementFailureRetryMatch = req.method === "POST"
    ? url.pathname.match(/^\/v1\/admin\/settlement-failures\/([^/]+)\/retry$/)
    : null;
  if (settlementFailureRetryMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const failureId = decodeURIComponent(settlementFailureRetryMatch[1]);
    const result = await platformService.retrySettlementFailure({ failureId, actorUserId: auth.userId });
    const response = result.ok
      ? json(200, { requestId, data: result.data })
      : json(result.code === "not_found" ? 404 : 409, {
          error: {
            code: result.code,
            message: result.message,
            requestId
          }
        });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/v1/admin/audit-logs") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const response = json(200, { requestId, data: await platformService.getAdminAuditLogs(limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/email-deliveries") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const response = json(200, { requestId, data: await platformService.listAdminEmailDeliveries(limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/security-events") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const response = json(200, { requestId, data: await platformService.listAdminSecurityEvents(limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/admin/notifications") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ title: string; body?: string; content?: string; type?: string; targetUserId?: string; targetHandle?: string }>(req);
    const notifContent = body.body ?? body.content ?? "";
    if (!body.title || !notifContent) {
      const response = json(400, { error: { message: "title and content are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    // Resolve targetHandle to targetUserId
    let targetUserId = body.targetUserId ?? null;
    if (!targetUserId && body.targetHandle) {
      const resolved = await platformService.findUserByHandle(body.targetHandle);
      if (!resolved) {
        const response = json(404, { error: { message: `user not found: ${body.targetHandle}`, requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      targetUserId = resolved.id;
    }
    const result = await platformService.createNotification({
      id: randomUUID(),
      title: body.title,
      body: notifContent,
      type: body.type ?? "announcement",
      targetUserId,
      createdBy: auth.userId
    });
    const response = json(201, { requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/notifications") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data: await platformService.listAdminNotifications() });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const reviewMatch = req.method === "POST"
    ? url.pathname.match(/^\/v1\/admin\/offerings\/([^/]+)\/review$/)
    : null;
  if (reviewMatch) {
    const auth = await authenticate_request_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (auth.role !== "admin") {
      const response = forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const offeringId = reviewMatch[1];
    const body = await read_json<ReviewOfferingBody>(req);
    if (body.reviewStatus !== "approved" && body.reviewStatus !== "rejected") {
      const response = json(400, {
        error: {
          message: "reviewStatus must be approved or rejected",
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const reviewResult = await platformService.reviewOffering({
      offeringId,
      reviewStatus: body.reviewStatus
    });

    if (!reviewResult.ok) {
      const response = json(reviewResult.code === "not_found" ? 404 : 409, {
        error: {
          message: reviewResult.message,
          code: reviewResult.code,
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    await platformService.writeAuditLog({
      actorUserId: auth.userId,
      action: "offering.reviewed",
      targetType: "offering",
      targetId: offeringId,
      payload: {
        reviewStatus: body.reviewStatus
      }
    });

    const response = json(200, {
      requestId,
      data: reviewResult.data
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // --- Provider Presets ---

  // GET /v1/admin/provider-presets
  if (req.method === "GET" && url.pathname === "/v1/admin/provider-presets") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const presets = await platformService.listProviderPresets();
    const response = json(200, { ok: true, data: presets, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // GET /v1/admin/provider-presets/audit-log
  if (req.method === "GET" && url.pathname === "/v1/admin/provider-presets/audit-log") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const currentPool = (await import("../repositories/index.js")).platformRepository;
    const result = await currentPool.getAuditLogsByTargetType("provider_preset", limit);
    const response = json(200, { ok: true, data: result, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // PUT /v1/admin/provider-presets/:id  &  DELETE /v1/admin/provider-presets/:id
  const presetMatch = url.pathname.match(/^\/v1\/admin\/provider-presets\/([^/]+)$/);

  if (req.method === "PUT" && presetMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const presetId = decodeURIComponent(presetMatch[1]);
    const body = await read_json<{ label: string; providerType: string; baseUrl: string; anthropicBaseUrl?: string; models?: unknown[]; enabled?: boolean; sortOrder?: number; customHeaders?: unknown }>(req);
    await platformService.upsertProviderPreset({
      id: presetId,
      label: body.label,
      providerType: body.providerType,
      baseUrl: body.baseUrl,
      anthropicBaseUrl: body.anthropicBaseUrl,
      models: body.models || [],
      enabled: body.enabled,
      sortOrder: body.sortOrder,
      updatedBy: auth.userId,
      customHeaders: body.customHeaders ?? null,
    });
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "update", targetType: "provider_preset", targetId: presetId,
      payload: { label: body.label, providerType: body.providerType, baseUrl: body.baseUrl },
    });
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // POST /v1/admin/provider-presets
  if (req.method === "POST" && url.pathname === "/v1/admin/provider-presets") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ id?: string; label?: string; providerType?: string; baseUrl?: string; anthropicBaseUrl?: string; models?: unknown[]; enabled?: boolean; sortOrder?: number; customHeaders?: unknown }>(req);
    if (!body.id || !body.label || !body.providerType || !body.baseUrl) {
      const response = json(400, { error: { code: "invalid_request", message: "id, label, providerType, and baseUrl are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    await platformService.upsertProviderPreset({
      id: body.id,
      label: body.label,
      providerType: body.providerType,
      baseUrl: body.baseUrl,
      anthropicBaseUrl: body.anthropicBaseUrl,
      models: body.models || [],
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
      updatedBy: auth.userId,
      customHeaders: body.customHeaders ?? null,
    });
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "create", targetType: "provider_preset", targetId: body.id,
      payload: { label: body.label, providerType: body.providerType, baseUrl: body.baseUrl },
    });
    const response = json(201, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // DELETE /v1/admin/provider-presets/:id
  if (req.method === "DELETE" && presetMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const presetIdToDelete = decodeURIComponent(presetMatch[1]);
    const deleted = await platformService.deleteProviderPreset(presetIdToDelete);
    if (deleted) {
      await platformRepository.writeAuditLog({
        actorUserId: auth.userId, action: "delete", targetType: "provider_preset", targetId: presetIdToDelete,
        payload: {},
      });
    }
    const response = json(deleted ? 200 : 404, { ok: deleted, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // DELETE /v1/admin/comments/:id — admin delete comment
  const adminDeleteCommentMatch = req.method === "DELETE"
    ? url.pathname.match(/^\/v1\/admin\/comments\/([^/]+)$/)
    : null;
  if (adminDeleteCommentMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const commentId = adminDeleteCommentMatch[1];
    await platformService.adminDeleteComment(commentId);
    const response = json(200, { requestId, ok: true });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  return false;
}
