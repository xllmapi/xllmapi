import type { IncomingMessage } from "node:http";

import { config } from "../config.js";
import { AppError } from "./errors.js";
import { platformService } from "../services/platform-service.js";

// --- Type definitions ---

export type CreateProviderCredentialBody = {
  providerId?: string;
  providerType?: "openai" | "anthropic" | "openai_compatible";
  baseUrl?: string;
  apiKey: string;
};

export type CreateOfferingBody = {
  logicalModel: string;
  credentialId: string;
  realModel: string;
  pricingMode?: "free" | "fixed_price" | "market_auto";
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  maxConcurrency?: number;
  dailyTokenLimit?: number;
};

export type UpdateProviderCredentialBody = {
  status: "active" | "disabled";
};

export type UpdateOfferingBody = {
  pricingMode?: "free" | "fixed_price" | "market_auto";
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  enabled?: boolean;
  dailyTokenLimit?: number;
  maxConcurrency?: number;
};

export type ReviewOfferingBody = {
  reviewStatus: "approved" | "rejected";
};

export type AuthRequestCodeBody = {
  email: string;
};

export type AuthVerifyCodeBody = {
  email: string;
  code: string;
};

export type AuthLoginBody = {
  email: string;
  password: string;
};

export type AuthRequestPasswordResetBody = {
  email: string;
};

export type AuthResetPasswordBody = {
  token: string;
  newPassword: string;
};

export type UpdateMeProfileBody = {
  displayName?: string;
  avatarUrl?: string;
};

export type UpdateMePasswordBody = {
  currentPassword?: string;
  newPassword: string;
};

export type UpdateMeEmailBody = {
  newEmail: string;
  currentPassword?: string;
};

export type ConfirmEmailChangeBody = {
  token: string;
};

export type UpdateMePhoneBody = {
  phone: string;
};

export type InvitationBody = {
  email: string;
  note?: string;
};

export type CreateConversationBody = {
  model: string;
  title?: string;
};

export type StreamConversationBody = {
  content: string;
  temperature?: number;
  max_tokens?: number;
};

// --- Shared utilities ---

export const json = (statusCode: number, body: unknown) => {
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

export const find_bearer_token_ = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, value] = authorizationHeader.split(" ", 2);
  if (!scheme || !value || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return value.trim();
};

const parse_cookies_ = (cookieHeader: string | undefined) => {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) {
      continue;
    }
    cookies.set(name, decodeURIComponent(value));
  }

  return cookies;
};

export const find_session_cookie_token_ = (req: IncomingMessage) =>
  parse_cookies_(typeof req.headers.cookie === "string" ? req.headers.cookie : undefined).get(config.sessionCookieName) ?? null;

const serialize_cookie_ = (name: string, value: string, params?: { maxAgeSeconds?: number; expires?: Date }) => {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (config.isProduction) {
    segments.push("Secure");
  }

  if (params?.maxAgeSeconds !== undefined) {
    segments.push(`Max-Age=${params.maxAgeSeconds}`);
  }

  if (params?.expires) {
    segments.push(`Expires=${params.expires.toUTCString()}`);
  }

  return segments.join("; ");
};

export const build_session_cookie_ = (sessionToken: string) =>
  serialize_cookie_(config.sessionCookieName, sessionToken, {
    maxAgeSeconds: config.sessionMaxAgeSeconds
  });

export const clear_session_cookie_ = () =>
  serialize_cookie_(config.sessionCookieName, "", {
    maxAgeSeconds: 0,
    expires: new Date(0)
  });

export const authenticate_request_ = async (req: IncomingMessage) => {
  const bearerToken = find_bearer_token_(req.headers.authorization);
  if (bearerToken?.startsWith("sess_")) {
    return await platformService.authenticateSession(bearerToken);
  }

  const apiKey = bearerToken ?? (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : null);
  if (apiKey) {
    return await platformService.authenticate(apiKey);
  }

  const sessionCookieToken = find_session_cookie_token_(req);
  if (!sessionCookieToken) {
    return null;
  }

  return await platformService.authenticateSession(sessionCookieToken);
};

export const authenticate_session_only_ = async (req: IncomingMessage) => {
  const bearerToken = find_bearer_token_(req.headers.authorization);
  if (bearerToken?.startsWith("sess_")) {
    return await platformService.authenticateSession(bearerToken);
  }

  const sessionCookieToken = find_session_cookie_token_(req);
  if (!sessionCookieToken) {
    return null;
  }

  return await platformService.authenticateSession(sessionCookieToken);
};

export const get_request_ip_ = (req: IncomingMessage) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return req.socket.remoteAddress ?? "unknown";
};

export const read_json = async <T>(req: IncomingMessage, options?: { maxBytes?: number }): Promise<T> => {
  const chunks: Buffer[] = [];
  const maxBytes = options?.maxBytes ?? config.requestBodyMaxBytes;
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new AppError(413, "payload_too_large", "request body too large");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim().length === 0) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AppError(400, "invalid_json", "invalid json payload");
  }
};

export const match_id_route_ = (pathname: string, prefix: string) => {
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const id = pathname.slice(prefix.length);
  if (!id || id.includes("/")) {
    return null;
  }

  return id;
};

export const has_legacy_model_prefix_ = (model: string) => model.trim().startsWith("xllm/");

export const unauthorized_ = (requestId: string) =>
  json(401, {
    error: {
      message: "missing or invalid authentication",
      requestId
    }
  });

export const forbidden_ = (requestId: string, message = "forbidden") =>
  json(403, {
    error: {
      message,
      requestId
    }
  });
