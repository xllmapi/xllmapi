import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import {
  type CoreChatExecuteResponse,
  type PublicChatCompletionsRequest,
  type PublicChatCompletionsResponse,
  type StreamCompletedEvent,
  exampleRouteExecuteRequest
} from "@xllmapi/shared-types";
import { DEV_ADMIN_API_KEY, DEV_USER_API_KEY } from "./constants.js";
import { cacheService } from "./cache.js";
import { config } from "./config.js";
import { metricsService } from "./metrics.js";
import { platformService } from "./services/platform-service.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const coreBaseUrl = process.env.CORE_BASE_URL ?? "http://127.0.0.1:4001";
const webDistRoot = resolve(process.cwd(), "apps/web/dist");
const webLegacyRoot = resolve(process.cwd(), "apps/web/_legacy");
const webRoot = existsSync(webDistRoot) ? webDistRoot : webLegacyRoot;

type SseEvent = {
  event: string;
  data: string;
};

type CreateProviderCredentialBody = {
  providerId?: string;
  providerType?: "openai" | "anthropic" | "openai_compatible";
  baseUrl?: string;
  apiKey: string;
};

type CreateOfferingBody = {
  logicalModel: string;
  credentialId: string;
  realModel: string;
  pricingMode?: "free" | "fixed_price" | "market_auto";
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
};

type UpdateProviderCredentialBody = {
  status: "active" | "disabled";
};

type UpdateOfferingBody = {
  pricingMode?: "free" | "fixed_price" | "market_auto";
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  enabled?: boolean;
};

type ReviewOfferingBody = {
  reviewStatus: "approved" | "rejected";
};

type AuthRequestCodeBody = {
  email: string;
};

type AuthVerifyCodeBody = {
  email: string;
  code: string;
};

type AuthLoginBody = {
  email: string;
  password: string;
};

type UpdateMeProfileBody = {
  displayName?: string;
  avatarUrl?: string;
};

type UpdateMePasswordBody = {
  currentPassword: string;
  newPassword: string;
};

type UpdateMeEmailBody = {
  newEmail: string;
};

type UpdateMePhoneBody = {
  phone: string;
};

type InvitationBody = {
  email: string;
  note?: string;
};

type CreateConversationBody = {
  model: string;
  title?: string;
};

type StreamConversationBody = {
  content: string;
  temperature?: number;
  max_tokens?: number;
};

const json = (statusCode: number, body: unknown) => {
  const payload = JSON.stringify(body, null, 2);
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload).toString()
    },
    payload
  };
};

const find_bearer_token_ = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, value] = authorizationHeader.split(" ", 2);
  if (!scheme || !value || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return value.trim();
};

const authenticate_request_ = async (req: IncomingMessage) => {
  const bearerToken = find_bearer_token_(req.headers.authorization);
  if (bearerToken?.startsWith("sess_")) {
    return await platformService.authenticateSession(bearerToken);
  }

  const apiKey = bearerToken ?? (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : null);
  if (!apiKey) {
    return null;
  }

  return await platformService.authenticate(apiKey);
};

const authenticate_session_only_ = async (req: IncomingMessage) => {
  const bearerToken = find_bearer_token_(req.headers.authorization);
  if (!bearerToken?.startsWith("sess_")) {
    return null;
  }
  return await platformService.authenticateSession(bearerToken);
};

const read_json = async <T>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as T;
};

const create_sse_parser_ = (onEvent: (event: SseEvent) => void) => {
  let buffer = "";

  return (chunkText: string) => {
    buffer += chunkText;

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventName = "message";
      const dataLines: string[] = [];

      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }

      onEvent({
        event: eventName,
        data: dataLines.join("\n")
      });
    }
  };
};

const match_id_route_ = (pathname: string, prefix: string) => {
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const id = pathname.slice(prefix.length);
  if (!id || id.includes("/")) {
    return null;
  }

  return id;
};

const has_legacy_model_prefix_ = (model: string) => model.trim().startsWith("xllm/");

const read_static_file_ = (pathname: string) => {
  // Never intercept API routes or internal paths
  if (pathname.startsWith("/v1/") || pathname.startsWith("/internal/") ||
      pathname === "/healthz" || pathname === "/metrics") {
    return null;
  }

  // Try to serve the exact file first (for assets like .js, .css, .svg, etc.)
  let target = resolve(webRoot, pathname.replace(/^\//, ""));

  // Security: ensure target is within webRoot
  if (!target.startsWith(webRoot)) {
    return null;
  }

  // If the exact file exists and is a file (not directory), serve it
  if (existsSync(target) && statSync(target).isFile()) {
    // Serve the file directly
  } else {
    // SPA fallback: serve index.html for all page routes
    target = resolve(webRoot, "index.html");
    if (!existsSync(target)) {
      return null;
    }
  }

  const contentType = (() => {
    switch (extname(target)) {
      case ".html":
        return "text/html; charset=utf-8";
      case ".css":
        return "text/css; charset=utf-8";
      case ".js":
        return "text/javascript; charset=utf-8";
      case ".svg":
        return "image/svg+xml";
      case ".png":
        return "image/png";
      case ".ico":
        return "image/x-icon";
      case ".woff":
        return "font/woff";
      case ".woff2":
        return "font/woff2";
      default:
        return "application/octet-stream";
    }
  })();

  return {
    contentType,
    content: readFileSync(target)
  };
};

const map_public_response = (
  model: string,
  response: CoreChatExecuteResponse
): PublicChatCompletionsResponse => ({
  id: response.executionId,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: response.outputText
      },
      finish_reason: "stop"
    }
  ],
  usage: {
    prompt_tokens: response.usage.inputTokens,
    completion_tokens: response.usage.outputTokens,
    total_tokens: response.usage.totalTokens
  },
  route: {
    offering_id: response.chosenOfferingId,
    provider: response.provider,
    real_model: response.realModel,
    fallback_used: response.fallbackUsed
  }
});

const unauthorized_ = (requestId: string) =>
  json(401, {
    error: {
      message: "missing or invalid authentication",
      requestId
    }
  });

const forbidden_ = (requestId: string, message = "forbidden") =>
  json(403, {
    error: {
      message,
      requestId
    }
  });

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  metricsService.increment("totalRequests");

  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      const cacheStatus = await cacheService.getStatus();
      const response = json(200, {
        ok: true,
        service: "platform-api",
        env: config.envMode,
        db: {
          driver: config.dbDriver,
          databaseUrlConfigured: Boolean(config.databaseUrl),
          sqliteDbPathConfigured: Boolean(config.sqliteDbPath)
        },
        cache: cacheStatus,
        requestId
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      const cacheStatus = await cacheService.getStatus();
      const response = json(200, {
        service: "platform-api",
        requestId,
        metrics: metricsService.snapshot(),
        cache: cacheStatus
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && (url.pathname === "/market" || url.pathname === "/market/")) {
      res.writeHead(302, { location: "/" });
      res.end();
      return;
    }

    const staticFile = req.method === "GET" ? read_static_file_(url.pathname) : null;
    if (staticFile) {
      res.writeHead(200, {
        "content-type": staticFile.contentType,
        "content-length": staticFile.content.byteLength.toString()
      });
      res.end(staticFile.content);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/auth/request-code") {
      const body = await read_json<AuthRequestCodeBody>(req);
      if (!body.email) {
        const response = json(400, { error: { message: "email is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
        return;
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
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/auth/verify-code") {
      const body = await read_json<AuthVerifyCodeBody>(req);
      if (!body.email || !body.code) {
        const response = json(400, { error: { message: "email and code are required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
          return;
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
        return;
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
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/auth/login") {
      const body = await read_json<AuthLoginBody>(req);
      if (!body.email || !body.password) {
        const response = json(400, { error: { message: "email and password are required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
        return;
      }

      const response = json(200, {
        ok: true,
        token: result.token,
        user: result.user,
        redirectTo: result.user.role === "admin" ? "/admin" : "/app"
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/auth/session") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const me = await platformService.getMe(auth.userId);
      const response = json(200, { ok: true, requestId, data: me });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/auth/logout") {
      const response = json(200, { ok: true, requestId });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/me") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const me = await platformService.getMe(auth.userId);
      const response = json(200, { requestId, data: me });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/v1/me/profile") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/v1/me/security/password") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const body = await read_json<UpdateMePasswordBody>(req);
      if (!body.currentPassword || !body.newPassword || body.newPassword.length < 8) {
        const response = json(400, { error: { message: "currentPassword and newPassword(min 8) are required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
        return;
      }
      const response = json(200, { ok: true, requestId });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/v1/me/security/email") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const body = await read_json<UpdateMeEmailBody>(req);
      if (!body.newEmail) {
        const response = json(400, { error: { message: "newEmail is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const result = await platformService.updateMeEmail({
        userId: auth.userId,
        newEmail: body.newEmail
      });
      if (!result.ok) {
        const response = json(409, { error: { code: result.code, message: result.message, requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const response = json(200, { ok: true, requestId, data: result.data ?? null });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/v1/me/security/phone") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const body = await read_json<UpdateMePhoneBody>(req);
      if (!body.phone) {
        const response = json(400, { error: { message: "phone is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const result = await platformService.updateMePhone({ userId: auth.userId, phone: body.phone });
      const response = json(200, { ok: true, requestId, data: result.data ?? null });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/me/invitation-stats") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, {
        requestId,
        data: await platformService.getInvitationStats(auth.userId)
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/invitations") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const response = json(200, { object: "list", data: await platformService.listInvitations(auth.userId) });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/invitations") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const body = await read_json<InvitationBody>(req);
      if (!body.email) {
        const response = json(400, { error: { message: "email is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
        return;
      }
      const response = json(201, { requestId, data: result.data });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
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
        return;
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
        return;
      }
      const response = json(200, { requestId, ok: true });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      const response = json(200, {
        object: "list",
        data: await platformService.listMarketModels()
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/network/models") {
      const response = json(200, {
        object: "list",
        data: await platformService.listMarketModels()
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/provider-catalog") {
      const auth = await authenticate_request_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, {
        object: "list",
        data: platformService.listProviderCatalog()
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/pricing/guidance") {
      const auth = await authenticate_request_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const logicalModel = url.searchParams.get("logicalModel")?.trim();
      if (!logicalModel) {
        const response = json(400, {
          error: {
            message: "logicalModel is required",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, {
        requestId,
        data: await platformService.getPricingGuidance(logicalModel)
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    const publicSupplierMatch = req.method === "GET"
      ? url.pathname.match(/^\/v1\/public\/users\/([^/]+)$/)
      : null;
    if (publicSupplierMatch) {
      const handle = decodeURIComponent(publicSupplierMatch[1]);
      const profile = await platformService.getPublicSupplierProfile(handle);
      if (!profile) {
        const response = json(404, { error: { message: "supplier not found", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const response = json(200, { requestId, data: profile });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    const publicSupplierOfferingsMatch = req.method === "GET"
      ? url.pathname.match(/^\/v1\/public\/users\/([^/]+)\/offerings$/)
      : null;
    if (publicSupplierOfferingsMatch) {
      const handle = decodeURIComponent(publicSupplierOfferingsMatch[1]);
      const response = json(200, {
        requestId,
        object: "list",
        data: await platformService.getPublicSupplierOfferings(handle)
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

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
        return;
      }
      const logicalModel = url.searchParams.get("model")?.trim();
      if (!logicalModel) {
        const response = json(400, { error: { message: "model is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      if (has_legacy_model_prefix_(logicalModel)) {
        const response = json(400, { error: { code: "invalid_model_name", message: "legacy model prefix xllm/ is no longer supported", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/conversations") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const body = await read_json<CreateConversationBody>(req);
      if (!body.model) {
        const response = json(400, { error: { message: "model is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      if (has_legacy_model_prefix_(body.model)) {
        const response = json(400, { error: { code: "invalid_model_name", message: "legacy model prefix xllm/ is no longer supported", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
      return;
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
        return;
      }
      const conversationId = decodeURIComponent(deleteConversationMatch[1]);
      await platformService.deleteChatConversation({
        conversationId,
        ownerUserId: auth.userId
      });
      const response = json(200, { requestId, deleted: true });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
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
        return;
      }
      const conversationId = decodeURIComponent(patchConversationMatch[1]);
      const body = await read_json<{ title: string }>(req);
      if (!body.title?.trim()) {
        const response = json(400, { error: { message: "title is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const updated = await platformService.updateChatConversationTitle({
        conversationId,
        ownerUserId: auth.userId,
        title: body.title.trim()
      });
      const response = json(200, { requestId, data: updated });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
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
        return;
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
      return;
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
        return;
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
        return;
      }
      const body = await read_json<StreamConversationBody>(req);
      if (!body.content?.trim()) {
        const response = json(400, { error: { message: "content is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const logicalModel = String(conversation.logicalModel ?? "");
      if (has_legacy_model_prefix_(logicalModel)) {
        const response = json(400, { error: { code: "invalid_model_name", message: "legacy model prefix xllm/ is no longer supported", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const candidateOfferings = await platformService.findOfferingsForModel(logicalModel);
      if (candidateOfferings.length === 0) {
        const response = json(404, { error: { message: `no offering available for ${logicalModel}`, requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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

      const mappedBody: PublicChatCompletionsRequest = {
        model: logicalModel,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        stream: true,
        messages: [
          ...history.map((item: { role: "system" | "user" | "assistant"; content: string }) => ({ role: item.role, content: item.content })),
          { role: "user", content: body.content.trim() }
        ]
      };
      const coreRequest = await platformService.buildCoreRequest(requestId, auth.userId, mappedBody, candidateOfferings);
      coreRequest.stream = true;

      const coreResponse = await fetch(`${coreBaseUrl}/internal/core/route-execute/chat-stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(coreRequest)
      });
      if (!coreResponse.ok || !coreResponse.body) {
        const errorBody = (await coreResponse.text()) || "";
        const response = json(502, { error: { message: `core returned ${coreResponse.status}`, details: errorBody, requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });

      const decoder = new TextDecoder();
      let completedEvent: StreamCompletedEvent | null = null;
      let assistantContent = "";
      const parseSse = create_sse_parser_((event) => {
        if (event.event === "completed") {
          completedEvent = JSON.parse(event.data) as StreamCompletedEvent;
          return;
        }
        try {
          const payload = JSON.parse(event.data);
          // Support both core-router format {"delta":"..."} and OpenAI format
          const coreRouterDelta = payload?.delta;
          const openaiDelta = payload?.choices?.[0]?.delta?.content;
          const msgContent = payload?.choices?.[0]?.message?.content;
          if (typeof coreRouterDelta === "string") {
            assistantContent += coreRouterDelta;
          } else if (typeof openaiDelta === "string") {
            assistantContent += openaiDelta;
          } else if (typeof msgContent === "string") {
            assistantContent += msgContent;
          }
        } catch {
          // passthrough payload may not be json chunk
        }
      });

      for await (const chunk of coreResponse.body as AsyncIterable<Uint8Array>) {
        const textChunk = decoder.decode(chunk, { stream: true });
        parseSse(textChunk);
        res.write(textChunk);
      }
      const finalChunk = decoder.decode();
      if (finalChunk) {
        parseSse(finalChunk);
        res.write(finalChunk);
      }

      const settlementEvent = completedEvent as StreamCompletedEvent | null;
      if (settlementEvent) {
        const settledOffering = candidateOfferings.find((item) => item.offeringId === settlementEvent.chosenOfferingId);
        if (settledOffering) {
          await platformService.recordChatSettlement({
            requestId,
            requesterUserId: auth.userId,
            supplierUserId: settledOffering.ownerUserId,
            logicalModel,
            offeringId: settlementEvent.chosenOfferingId,
            provider: settlementEvent.provider,
            realModel: settlementEvent.realModel,
            inputTokens: settlementEvent.usage.inputTokens,
            outputTokens: settlementEvent.usage.outputTokens,
            totalTokens: settlementEvent.usage.totalTokens,
            fixedPricePer1kInput: settledOffering.fixedPricePer1kInput ?? 0,
            fixedPricePer1kOutput: settledOffering.fixedPricePer1kOutput ?? 0
          });
          await platformService.appendChatMessage({
            id: `msg_${randomUUID().replaceAll("-", "")}`,
            conversationId,
            role: "assistant",
            content: assistantContent || "",
            requestId
          });
        }
      }

      res.end();
      return;
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
        return;
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
        return;
      }

      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
        return;
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
          return;
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
          return;
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
        return;
      }

      const candidateOfferings = await platformService.findOfferingsForModel(body.model);
      if (candidateOfferings.length === 0) {
        const response = json(404, {
          error: {
            message: `no offering available for ${body.model}`,
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const coreRequest = await platformService.buildCoreRequest(requestId, requesterUserId, body, candidateOfferings);

      if (body.stream) {
        coreRequest.stream = true;

        const coreResponse = await fetch(`${coreBaseUrl}/internal/core/route-execute/chat-stream`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(coreRequest)
        });

        if (!coreResponse.ok || !coreResponse.body) {
          metricsService.increment("coreErrors");
          const coreErrorBody = (await coreResponse.text()) || "";
          const response = json(502, {
            error: {
              message: `core returned ${coreResponse.status}`,
              details: coreErrorBody,
              requestId
            }
          });
          res.writeHead(response.statusCode, response.headers);
          res.end(response.payload);
          return;
        }

        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });

        const decoder = new TextDecoder();
        let completedEvent: StreamCompletedEvent | null = null;
        const parseSse = create_sse_parser_((event) => {
          if (event.event === "completed") {
            completedEvent = JSON.parse(event.data) as StreamCompletedEvent;
          }
        });

        for await (const chunk of coreResponse.body as AsyncIterable<Uint8Array>) {
          const textChunk = decoder.decode(chunk, { stream: true });
          parseSse(textChunk);
          res.write(textChunk);
        }

        const finalChunk = decoder.decode();
        if (finalChunk) {
          parseSse(finalChunk);
          res.write(finalChunk);
        }

        const settlementEvent = completedEvent as StreamCompletedEvent | null;
        if (settlementEvent !== null) {
          const settledOffering = candidateOfferings.find((item) => item.offeringId === settlementEvent.chosenOfferingId);
          if (!settledOffering) {
            throw new Error(`chosen offering ${settlementEvent.chosenOfferingId} missing from candidate set`);
          }
          await platformService.recordChatSettlement({
            requestId,
            requesterUserId,
            supplierUserId: settledOffering.ownerUserId,
            logicalModel: body.model,
            idempotencyKey,
            offeringId: settlementEvent.chosenOfferingId,
            provider: settlementEvent.provider,
            realModel: settlementEvent.realModel,
            inputTokens: settlementEvent.usage.inputTokens,
            outputTokens: settlementEvent.usage.outputTokens,
            totalTokens: settlementEvent.usage.totalTokens,
            fixedPricePer1kInput: settledOffering.fixedPricePer1kInput ?? 0,
            fixedPricePer1kOutput: settledOffering.fixedPricePer1kOutput ?? 0
          });
        }

        res.end();
        return;
      }

      const coreResponse = await fetch(`${coreBaseUrl}/internal/core/route-execute/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(coreRequest)
      });

      if (!coreResponse.ok) {
        metricsService.increment("coreErrors");
        const coreErrorBody = (await coreResponse.text()) || "";
        const response = json(502, {
          error: {
            message: `core returned ${coreResponse.status}`,
            details: coreErrorBody,
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const result = (await coreResponse.json()) as CoreChatExecuteResponse;
      const settledOffering = candidateOfferings.find((item) => item.offeringId === result.chosenOfferingId);
      if (!settledOffering) {
        throw new Error(`chosen offering ${result.chosenOfferingId} missing from candidate set`);
      }
      const publicResponse = map_public_response(body.model, result);
      await platformService.recordChatSettlement({
        requestId,
        requesterUserId,
        supplierUserId: settledOffering.ownerUserId,
        logicalModel: body.model,
        idempotencyKey,
        offeringId: result.chosenOfferingId,
        provider: result.provider,
        realModel: result.realModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        fixedPricePer1kInput: settledOffering.fixedPricePer1kInput ?? 0,
        fixedPricePer1kOutput: settledOffering.fixedPricePer1kOutput ?? 0,
        responseBody: publicResponse
      });

      const response = json(200, publicResponse);
      if (idempotencyKey) {
        await cacheService.setCachedResponse({
          key: `${requesterUserId}:${idempotencyKey}`,
          value: response.payload
        });
      }
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
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
        return;
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
        return;
      }

      const candidateOfferings = await platformService.findOfferingsForModel(mappedBody.model);
      if (candidateOfferings.length === 0) {
        const response = json(404, {
          error: { message: `no offering available for ${mappedBody.model}`, requestId }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const coreRequest = await platformService.buildCoreRequest(requestId, auth.userId, mappedBody, candidateOfferings);
      const coreResponse = await fetch(`${coreBaseUrl}/internal/core/route-execute/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(coreRequest)
      });
      if (!coreResponse.ok) {
        const response = json(502, { error: { message: `core returned ${coreResponse.status}`, requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const result = (await coreResponse.json()) as CoreChatExecuteResponse;
      const settledOffering = candidateOfferings.find((item) => item.offeringId === result.chosenOfferingId);
      if (!settledOffering) {
        throw new Error(`chosen offering ${result.chosenOfferingId} missing from candidate set`);
      }
      await platformService.recordChatSettlement({
        requestId,
        requesterUserId: auth.userId,
        supplierUserId: settledOffering.ownerUserId,
        logicalModel: mappedBody.model,
        offeringId: result.chosenOfferingId,
        provider: result.provider,
        realModel: result.realModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        fixedPricePer1kInput: settledOffering.fixedPricePer1kInput ?? 0,
        fixedPricePer1kOutput: settledOffering.fixedPricePer1kOutput ?? 0
      });
      const response = json(200, {
        id: result.executionId,
        type: "message",
        role: "assistant",
        model: mappedBody.model,
        content: [
          {
            type: "text",
            text: result.outputText
          }
        ],
        stop_reason: "end_turn",
        usage: {
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/wallet") {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, {
        userId: auth.userId,
        apiKeyId: "apiKeyId" in auth ? auth.apiKeyId : null,
        label: "label" in auth ? auth.label : "session",
        balance: await platformService.getWallet(auth.userId),
        unit: "token_credit"
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/provider-credentials") {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, {
        object: "list",
        data: await platformService.listProviderCredentials(auth.userId)
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    const providerCredentialId = match_id_route_(url.pathname, "/v1/provider-credentials/");
    if (req.method === "PATCH" && providerCredentialId) {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const body = await read_json<UpdateProviderCredentialBody>(req);
      if (body.status !== "active" && body.status !== "disabled") {
        const response = json(400, {
          error: {
            message: "status must be active or disabled",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const credential = await platformService.updateProviderCredentialStatus({
        ownerUserId: auth.userId,
        credentialId: providerCredentialId,
        status: body.status
      });

      if (!credential.ok) {
        const response = json(credential.code === "not_found" ? 404 : 409, {
          error: {
            message: credential.message,
            code: credential.code,
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      if (!credential.data) {
        const response = json(404, {
          error: {
            message: "credential not found for current user",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, {
        requestId,
        data: credential.data
      });
      await platformService.writeAuditLog({
        actorUserId: auth.userId,
        action: "provider_credential.status_updated",
        targetType: "provider_credential",
        targetId: providerCredentialId,
        payload: { status: body.status }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "DELETE" && providerCredentialId) {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const result = await platformService.removeProviderCredential({
        ownerUserId: auth.userId,
        credentialId: providerCredentialId
      });

      if (!result.ok) {
        const response = json(result.code === "not_found" ? 404 : 409, {
          error: {
            message: result.message,
            code: result.code,
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, { requestId, ok: true });
      await platformService.writeAuditLog({
        actorUserId: auth.userId,
        action: "provider_credential.deleted",
        targetType: "provider_credential",
        targetId: providerCredentialId,
        payload: {}
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/provider-credentials") {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const body = await read_json<CreateProviderCredentialBody>(req);
      const providerPreset = body.providerId ? platformService.getProviderPresetById(body.providerId) : null;
      const resolvedProviderType = providerPreset?.providerType ?? body.providerType;
      const resolvedBaseUrl = (body.baseUrl?.trim() || providerPreset?.baseUrl || "").trim();

      if (!resolvedProviderType || !body.apiKey) {
        const response = json(400, {
          error: {
            message: "providerType (or providerId) and apiKey are required",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      if (resolvedProviderType === "openai_compatible" && !resolvedBaseUrl) {
        const response = json(400, {
          error: {
            message: "baseUrl is required for openai_compatible provider",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const connectivity = await platformService.validateProviderCredential({
        providerType: resolvedProviderType,
        baseUrl: resolvedBaseUrl,
        apiKey: body.apiKey,
        testModel: providerPreset?.realModel
      });
      if (!connectivity.ok) {
        const response = json(400, {
          error: {
            code: "risk_connection_failed",
            message: connectivity.message,
            details: connectivity.details,
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const created = await platformService.createProviderCredential({
        id: `cred_${randomUUID()}`,
        ownerUserId: auth.userId,
        providerType: resolvedProviderType,
        baseUrl: resolvedBaseUrl,
        apiKey: body.apiKey
      });
      if (created && typeof created === "object" && "ok" in created && created.ok === false) {
        const response = json(created.code === "duplicate_provider_key" ? 409 : 400, {
          error: {
            message: created.message,
            code: created.code,
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const credential = created && typeof created === "object" && "ok" in created
        ? created.data
        : created;

      const response = json(201, {
        requestId,
        data: credential
      });
      await platformService.writeAuditLog({
        actorUserId: auth.userId,
        action: "provider_credential.created",
        targetType: "provider_credential",
        targetId: String(credential?.id ?? "unknown"),
        payload: {
          providerType: resolvedProviderType,
          baseUrl: resolvedBaseUrl || null,
          providerId: body.providerId ?? null
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/offerings") {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, {
        object: "list",
        data: await platformService.listOfferings(auth.userId)
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    const offeringId = match_id_route_(url.pathname, "/v1/offerings/");
    if (req.method === "PATCH" && offeringId) {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const body = await read_json<UpdateOfferingBody>(req);
      const offering = await platformService.updateOffering({
        ownerUserId: auth.userId,
        offeringId,
        pricingMode: body.pricingMode,
        fixedPricePer1kInput: body.fixedPricePer1kInput,
        fixedPricePer1kOutput: body.fixedPricePer1kOutput,
        enabled: body.enabled
      });

      if (!offering.ok) {
        const response = json(offering.code === "not_found" ? 404 : 409, {
          error: {
            message: offering.message,
            code: offering.code,
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      if (!offering.data) {
        const response = json(404, {
          error: {
            message: "offering not found for current user",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, {
        requestId,
        data: offering.data
      });
      await platformService.writeAuditLog({
        actorUserId: auth.userId,
        action: "offering.updated",
        targetType: "offering",
        targetId: offeringId,
        payload: body
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "DELETE" && offeringId) {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const result = await platformService.removeOffering({
        ownerUserId: auth.userId,
        offeringId
      });

      if (!result.ok) {
        const response = json(result.code === "not_found" ? 404 : 409, {
          error: {
            message: result.message,
            code: result.code,
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, { requestId, ok: true });
      await platformService.writeAuditLog({
        actorUserId: auth.userId,
        action: "offering.deleted",
        targetType: "offering",
        targetId: offeringId,
        payload: {}
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/offerings") {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const body = await read_json<CreateOfferingBody>(req);
      if (!body.logicalModel || !body.credentialId || !body.realModel) {
        const response = json(400, {
          error: {
            message: "logicalModel, credentialId, and realModel are required",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      if (has_legacy_model_prefix_(body.logicalModel)) {
        const response = json(400, {
          error: {
            code: "invalid_model_name",
            message: "legacy model prefix xllm/ is no longer supported",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const credential = await platformService.getProviderCredential(auth.userId, body.credentialId);
      if (!credential) {
        const response = json(404, {
          error: {
            message: "credential not found for current user",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      if (credential.status !== "active") {
        const response = json(409, {
          error: {
            message: "credential must be active before creating an offering",
            code: "risk_inactive_credential",
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const guidance = await platformService.getPricingGuidance(body.logicalModel);
      const fixedPricePer1kInput = (typeof body.fixedPricePer1kInput === "number" && body.fixedPricePer1kInput > 0)
        ? body.fixedPricePer1kInput
        : guidance.inputPricePer1k;
      const fixedPricePer1kOutput = (typeof body.fixedPricePer1kOutput === "number" && body.fixedPricePer1kOutput > 0)
        ? body.fixedPricePer1kOutput
        : guidance.outputPricePer1k;

      const offering = await platformService.createOffering({
        id: `offering_${randomUUID()}`,
        ownerUserId: auth.userId,
        logicalModel: body.logicalModel,
        credentialId: body.credentialId,
        realModel: body.realModel,
        pricingMode: body.pricingMode ?? "fixed_price",
        fixedPricePer1kInput,
        fixedPricePer1kOutput
      });

      const response = json(201, {
        requestId,
        data: offering,
        pricingGuidance: guidance
      });
      await platformService.writeAuditLog({
        actorUserId: auth.userId,
        action: "offering.created",
        targetType: "offering",
        targetId: String(offering?.id ?? "unknown"),
        payload: {
          logicalModel: body.logicalModel,
          credentialId: body.credentialId,
          realModel: body.realModel,
          autoApproved: true
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/offerings/pending") {
      const auth = await authenticate_request_(req);
      if (!auth) {
        metricsService.increment("authFailures");
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      if (auth.role !== "admin") {
        const response = forbidden_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }

      const response = json(200, {
        object: "list",
        data: await platformService.listPendingOfferings()
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/invitations") {
      const auth = await authenticate_session_only_(req);
      if (!auth || auth.role !== "admin") {
        const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const response = json(200, { object: "list", data: await platformService.listAdminInvitations() });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/users") {
      const auth = await authenticate_session_only_(req);
      if (!auth || auth.role !== "admin") {
        const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const response = json(200, { object: "list", data: await platformService.listAdminUsers() });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/admin/invitations") {
      const auth = await authenticate_session_only_(req);
      if (!auth || auth.role !== "admin") {
        const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const body = await read_json<InvitationBody>(req);
      if (!body.email) {
        const response = json(400, { error: { message: "email is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
        return;
      }
      const response = json(201, { requestId, data: result.data });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/usage/supply") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const response = json(200, { requestId, data: await platformService.getSupplyUsage(auth.userId) });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/usage/consumption") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const response = json(200, { requestId, data: await platformService.getConsumptionUsage(auth.userId) });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/usage") {
      const auth = await authenticate_session_only_(req);
      if (!auth || auth.role !== "admin") {
        const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
      }
      const response = json(200, { requestId, data: await platformService.getAdminUsageSummary() });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
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
        return;
      }

      if (auth.role !== "admin") {
        const response = forbidden_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return;
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
        return;
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
        return;
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
      return;
    }

    if (req.method === "POST" && url.pathname === "/internal/debug/core-request") {
      const response = json(200, {
        requestId,
        coreRequest: exampleRouteExecuteRequest()
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/internal/debug/state") {
      const response = json(200, {
        requestId,
        state: await platformService.getDebugState(),
        devApiKey: DEV_USER_API_KEY,
        devAdminApiKey: DEV_ADMIN_API_KEY,
        sampleCoreRequest: exampleRouteExecuteRequest()
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    const response = json(404, {
      error: {
        message: "Not found",
        requestId
      }
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
  } catch (error) {
    const response = json(500, {
      error: {
        message: error instanceof Error ? error.message : "unexpected error",
        requestId
      }
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
  }
});

server.listen(port, host, () => {
  console.log(`platform-api listening on http://${host}:${port}`);
});
