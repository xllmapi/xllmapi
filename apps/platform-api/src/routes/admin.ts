import type { IncomingMessage, ServerResponse } from "node:http";

import {
  json,
  read_json,
  authenticate_request_,
  authenticate_session_only_,
  unauthorized_,
  forbidden_,
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
    const response = json(200, { requestId, data: await platformService.getAdminUsageSummary() });
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
