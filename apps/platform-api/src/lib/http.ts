import type { IncomingMessage } from "node:http";

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
};

export type UpdateProviderCredentialBody = {
  status: "active" | "disabled";
};

export type UpdateOfferingBody = {
  pricingMode?: "free" | "fixed_price" | "market_auto";
  fixedPricePer1kInput?: number;
  fixedPricePer1kOutput?: number;
  enabled?: boolean;
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

export type UpdateMeProfileBody = {
  displayName?: string;
  avatarUrl?: string;
};

export type UpdateMePasswordBody = {
  currentPassword: string;
  newPassword: string;
};

export type UpdateMeEmailBody = {
  newEmail: string;
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

export const authenticate_request_ = async (req: IncomingMessage) => {
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

export const authenticate_session_only_ = async (req: IncomingMessage) => {
  const bearerToken = find_bearer_token_(req.headers.authorization);
  if (!bearerToken?.startsWith("sess_")) {
    return null;
  }
  return await platformService.authenticateSession(bearerToken);
};

export const read_json = async <T>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as T;
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
