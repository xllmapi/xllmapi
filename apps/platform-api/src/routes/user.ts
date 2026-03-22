import type { IncomingMessage, ServerResponse } from "node:http";

import {
  json,
  read_json,
  authenticate_session_only_,
  unauthorized_,
  type UpdateMeProfileBody,
  type UpdateMePasswordBody,
  type UpdateMeEmailBody,
  type UpdateMePhoneBody,
  type InvitationBody
} from "../lib/http.js";
import { platformService } from "../services/platform-service.js";

export async function handleUserRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  if (req.method === "GET" && url.pathname === "/v1/me") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const me = await platformService.getMe(auth.userId);
    const response = json(200, { requestId, data: me });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/v1/me/profile") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<UpdateMeProfileBody>(req);
    const profile = await platformService.updateMeProfile({
      userId: auth.userId,
      displayName: body.displayName,
      avatarUrl: body.avatarUrl
    });
    const response = json(200, { requestId, data: profile });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/v1/me/security/password") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<UpdateMePasswordBody>(req);
    if (!body.currentPassword || !body.newPassword || body.newPassword.length < 8) {
      const response = json(400, { error: { message: "currentPassword and newPassword(min 8) are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.updateMePassword({
      userId: auth.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword
    });
    if (!result.ok) {
      const response = json(400, { error: { code: result.code, message: result.message, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/v1/me/security/email") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<UpdateMeEmailBody>(req);
    if (!body.newEmail) {
      const response = json(400, { error: { message: "newEmail is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.updateMeEmail({
      userId: auth.userId,
      newEmail: body.newEmail
    });
    if (!result.ok) {
      const response = json(409, { error: { code: result.code, message: result.message, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { ok: true, requestId, data: result.data ?? null });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/v1/me/security/phone") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<UpdateMePhoneBody>(req);
    if (!body.phone) {
      const response = json(400, { error: { message: "phone is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.updateMePhone({ userId: auth.userId, phone: body.phone });
    const response = json(200, { ok: true, requestId, data: result.data ?? null });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/me/invitation-stats") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, {
      requestId,
      data: await platformService.getInvitationStats(auth.userId)
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/invitations") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { object: "list", data: await platformService.listInvitations(auth.userId) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/invitations") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
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
    const result = await platformService.createInvitation({
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

  const invitationRevokeMatch = req.method === "POST"
    ? url.pathname.match(/^\/v1\/invitations\/([^/]+)\/revoke$/)
    : null;
  if (invitationRevokeMatch) {
    const invitationId = invitationRevokeMatch[1];
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.revokeInvitation({
      actorUserId: auth.userId,
      invitationId,
      isAdmin: auth.role === "admin"
    });
    if (!result.ok) {
      const response = json(result.code === "not_found" ? 404 : 409, {
        error: { code: result.code, message: result.message, requestId }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, ok: true });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  return false;
}
