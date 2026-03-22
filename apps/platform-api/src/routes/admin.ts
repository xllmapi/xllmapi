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

  if (req.method === "POST" && url.pathname === "/v1/admin/notifications") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ title: string; body: string; type?: string; targetUserId?: string }>(req);
    if (!body.title || !body.body) {
      const response = json(400, { error: { message: "title and body are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.createNotification({
      id: randomUUID(),
      title: body.title,
      body: body.body,
      type: body.type ?? "announcement",
      targetUserId: body.targetUserId ?? null,
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

  return false;
}
