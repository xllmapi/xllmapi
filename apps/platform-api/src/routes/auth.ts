import type { IncomingMessage, ServerResponse } from "node:http";

import { cacheService } from "../cache.js";
import { config } from "../config.js";
import {
  json,
  read_json,
  authenticate_session_only_,
  unauthorized_,
  get_request_ip_,
  build_session_cookie_,
  clear_session_cookie_,
  type AuthRequestCodeBody,
  type AuthVerifyCodeBody,
  type AuthLoginBody,
  type AuthRequestPasswordResetBody,
  type AuthResetPasswordBody
} from "../lib/http.js";
import { metricsService } from "../metrics.js";
import { platformService } from "../services/platform-service.js";

const normalizeEmailForLimit = (email: string) => email.trim().toLowerCase();

async function enforceAuthRateLimit(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  route: string;
  identity: string;
  limit: number;
}): Promise<boolean> {
  const rateLimit = await cacheService.consumeRateLimit({
    key: `auth:${params.route}:${params.identity}:${get_request_ip_(params.req)}`,
    limit: params.limit,
    windowMs: 60_000
  });

  if (rateLimit.ok) {
    return true;
  }

  metricsService.increment("authRateLimitHits");
  const response = json(429, {
    error: {
      code: "auth_rate_limited",
      message: "too many authentication attempts",
      requestId: params.requestId,
      resetAt: new Date(rateLimit.resetAt).toISOString()
    }
  });
  params.res.writeHead(response.statusCode, {
    ...response.headers,
    "x-ratelimit-limit": String(params.limit),
    "x-ratelimit-remaining": String(rateLimit.remaining),
    "x-ratelimit-reset": String(rateLimit.resetAt)
  });
  params.res.end(response.payload);
  return false;
}

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

    if (!(await enforceAuthRateLimit({
      req,
      res,
      requestId,
      route: "request-code",
      identity: normalizeEmailForLimit(body.email),
      limit: config.authRequestCodeLimitPerMinute
    }))) {
      return true;
    }

    const result = await platformService.requestLoginCode(body.email);
    if (!result.eligible) {
      // Return generic success to avoid leaking whether email is invited
      const response = json(200, {
        ok: true,
        requestId,
        channel: "email",
        firstLogin: true,
        maskedEmail: body.email.replace(/^(.).+(@.*)$/, "$1***$2"),
        cooldownSeconds: config.emailSendCooldownSeconds,
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, {
      ok: true,
      requestId,
      channel: "email",
      firstLogin: result.firstLogin,
      maskedEmail: body.email.replace(/^(.).+(@.*)$/, "$1***$2"),
      cooldownSeconds: config.emailSendCooldownSeconds,
      ...(config.isProduction ? {} : { devCode: result.code })
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/auth/confirm-email-change") {
    const body = await read_json<{ token: string }>(req);
    if (!body.token) {
      const response = json(400, { error: { message: "token is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const auth = await authenticate_session_only_(req);
    const result = await platformService.confirmMeEmailChange({
      token: body.token,
      sessionId: auth?.sessionId ?? null
    });
    if (!result.ok) {
      const response = json(400, { error: { code: result.code, message: result.message, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, { ok: true, requestId, data: result.data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/auth/request-password-reset") {
    const body = await read_json<AuthRequestPasswordResetBody>(req);
    if (!body.email) {
      const response = json(400, { error: { message: "email is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (!(await enforceAuthRateLimit({
      req,
      res,
      requestId,
      route: "request-password-reset",
      identity: normalizeEmailForLimit(body.email),
      limit: config.authRequestCodeLimitPerMinute
    }))) {
      return true;
    }

    const result = await platformService.requestPasswordReset(body.email);
    if (!result.accepted) {
      const response = json(404, {
        error: { code: "not_found", message: "email not registered", requestId }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const maskedEmail = body.email.replace(/^(.).+(@.*)$/, "$1***$2");
    const response = json(200, {
      ok: true,
      requestId,
      maskedEmail,
      cooldownSeconds: config.emailSendCooldownSeconds
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/auth/reset-password") {
    const body = await read_json<AuthResetPasswordBody>(req);
    if (!body.token || !body.newPassword || body.newPassword.length < 8) {
      const response = json(400, { error: { message: "token and newPassword(min 8) are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const result = await platformService.resetPassword({
      token: body.token,
      newPassword: body.newPassword
    });
    if (!result.ok) {
      const response = json(400, { error: { code: result.code, message: result.message, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, { ok: true, requestId, data: result.data });
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

    if (!(await enforceAuthRateLimit({
      req,
      res,
      requestId,
      route: "verify-code",
      identity: normalizeEmailForLimit(body.email),
      limit: config.authVerifyCodeLimitPerMinute
    }))) {
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
    res.writeHead(response.statusCode, {
      ...response.headers,
      "set-cookie": build_session_cookie_(result.token)
    });
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

    if (!(await enforceAuthRateLimit({
      req,
      res,
      requestId,
      route: "login",
      identity: normalizeEmailForLimit(body.email),
      limit: config.authPasswordLoginLimitPerMinute
    }))) {
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
    res.writeHead(response.statusCode, {
      ...response.headers,
      "set-cookie": build_session_cookie_(result.token)
    });
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
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    await platformService.revokeSession(auth.sessionId);
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, {
      ...response.headers,
      "set-cookie": clear_session_cookie_()
    });
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
