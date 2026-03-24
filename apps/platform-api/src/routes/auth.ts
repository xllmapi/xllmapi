import type { IncomingMessage, ServerResponse } from "node:http";

import { config } from "../config.js";
import {
  json,
  read_json,
  authenticate_session_only_,
  unauthorized_,
  type AuthRequestCodeBody,
  type AuthVerifyCodeBody,
  type AuthLoginBody
} from "../lib/http.js";
import { platformService } from "../services/platform-service.js";

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  if (req.method === "POST" && url.pathname === "/v1/auth/request-code") {
    const body = await read_json<AuthRequestCodeBody>(req);
    if (!body.email) {
      const response = json(400, { error: { message: "email is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const result = await platformService.requestLoginCode(body.email);
    if (!result.eligible) {
      const response = json(403, {
        error: {
          code: "invite_required",
          message: "email has not been invited",
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, {
      ok: true,
      requestId,
      eligible: true,
      firstLogin: result.firstLogin,
      ...(config.isProduction ? {} : { devCode: result.code })
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/auth/verify-code") {
    const body = await read_json<AuthVerifyCodeBody>(req);
    if (!body.email || !body.code) {
      const response = json(400, { error: { message: "email and code are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    let verifyCode = body.code;
    if (!config.isProduction && body.code === "000000") {
      const issue = await platformService.requestLoginCode(body.email);
      if (!issue.eligible || !issue.code) {
        const response = json(403, {
          error: {
            code: "invite_required",
            message: "email has not been invited",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      verifyCode = issue.code;
    }

    const result = await platformService.verifyLoginCode(body.email, verifyCode);
    if (!result.ok) {
      const response = json(result.code === "invite_required" ? 403 : 400, {
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

    const response = json(200, {
      ok: true,
      token: result.token,
      user: result.user,
      redirectTo: result.user.role === "admin" ? "/admin" : "/app",
      firstLoginCompleted: result.firstLoginCompleted,
      initialApiKey: result.initialApiKey ?? null
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/auth/login") {
    const body = await read_json<AuthLoginBody>(req);
    if (!body.email || !body.password) {
      const response = json(400, { error: { message: "email and password are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const result = await platformService.loginWithPassword(body.email, body.password);
    if (!result.ok) {
      const response = json(401, {
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

    const response = json(200, {
      ok: true,
      token: result.token,
      user: result.user,
      redirectTo: result.user.role === "admin" ? "/admin" : "/app"
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/auth/session") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const me = await platformService.getMe(auth.userId);
    const response = json(200, { ok: true, requestId, data: me });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/auth/logout") {
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // --- API Key Management ---

  if (req.method === "GET" && url.pathname === "/v1/me/api-keys") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const keys = await platformService.listApiKeys(auth.userId);
    const response = json(200, { ok: true, requestId, data: keys });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/me/api-keys") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ label?: string }>(req);
    const label = body.label || "API Key";
    const result = await platformService.createApiKey(auth.userId, label);
    const response = json(201, { ok: true, requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/v1/me/api-keys/")) {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const keyId = url.pathname.slice("/v1/me/api-keys/".length);
    const ok = await platformService.revokeApiKey(auth.userId, keyId);
    const response = ok
      ? json(200, { ok: true, requestId })
      : json(404, { error: { message: "API key not found", requestId } });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  return false;
}
