import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type { CandidateOffering } from "@xllmapi/shared-types";
import {
  json,
  read_json,
  authenticate_request_,
  unauthorized_,
  match_id_route_,
  has_legacy_model_prefix_,
  type CreateProviderCredentialBody,
  type UpdateProviderCredentialBody,
  type CreateOfferingBody,
  type UpdateOfferingBody
} from "../lib/http.js";
import { metricsService } from "../metrics.js";
import { platformService } from "../services/platform-service.js";

export async function handleProviderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  if (req.method === "GET" && url.pathname === "/v1/provider-catalog") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, {
      object: "list",
      data: await platformService.listProviderCatalog()
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/provider-models") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const body = await read_json<{
      providerType?: string;
      baseUrl?: string;
      apiKey?: string;
      providerId?: string;
    }>(req);

    const providerPreset = body.providerId ? await platformService.getProviderPresetById(body.providerId) : null;
    const providerType = (providerPreset?.providerType ?? body.providerType) as CandidateOffering["providerType"] | undefined;
    const baseUrl = (body.baseUrl?.trim() || providerPreset?.baseUrl || "").trim();

    if (!providerType || !body.apiKey || !baseUrl) {
      const response = json(400, {
        error: { message: "providerType (or providerId), baseUrl, and apiKey are required", requestId }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const result = await platformService.discoverProviderModels({
      providerType,
      baseUrl,
      apiKey: body.apiKey
    });

    const response = json(result.ok ? 200 : 502, {
      requestId,
      ok: result.ok,
      data: result.models ?? [],
      message: result.message
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/provider-credentials") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, {
      object: "list",
      data: await platformService.listProviderCredentials(auth.userId)
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const providerCredentialId = match_id_route_(url.pathname, "/v1/provider-credentials/");
  if (req.method === "PATCH" && providerCredentialId) {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
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
      return true;
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
      return true;
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
      return true;
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
    return true;
  }

  if (req.method === "DELETE" && providerCredentialId) {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
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
      return true;
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
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/provider-credentials") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const body = await read_json<CreateProviderCredentialBody>(req);
    const providerPreset = body.providerId ? await platformService.getProviderPresetById(body.providerId) : null;
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
      return true;
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
      return true;
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
      return true;
    }

    const created = await platformService.createProviderCredential({
      id: `cred_${randomUUID()}`,
      ownerUserId: auth.userId,
      providerType: resolvedProviderType,
      baseUrl: resolvedBaseUrl,
      anthropicBaseUrl: providerPreset?.anthropicBaseUrl,
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
      return true;
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
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/offerings") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, {
      object: "list",
      data: await platformService.listOfferings(auth.userId)
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const offeringId = match_id_route_(url.pathname, "/v1/offerings/");
  if (req.method === "PATCH" && offeringId) {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const body = await read_json<UpdateOfferingBody>(req);

    if (typeof body.fixedPricePer1kInput === "number" || typeof body.fixedPricePer1kOutput === "number") {
      const minInput = Number(await platformService.getConfigValue("min_input_price_per_1k")) || 0;
      const maxInput = Number(await platformService.getConfigValue("max_input_price_per_1k")) || Infinity;
      const minOutput = Number(await platformService.getConfigValue("min_output_price_per_1k")) || 0;
      const maxOutput = Number(await platformService.getConfigValue("max_output_price_per_1k")) || Infinity;
      if ((typeof body.fixedPricePer1kInput === "number" && (body.fixedPricePer1kInput < minInput || body.fixedPricePer1kInput > maxInput)) ||
          (typeof body.fixedPricePer1kOutput === "number" && (body.fixedPricePer1kOutput < minOutput || body.fixedPricePer1kOutput > maxOutput))) {
        const response = json(400, {
          error: {
            code: "price_out_of_range",
            message: `Price must be within configured limits: input [${minInput}, ${maxInput}], output [${minOutput}, ${maxOutput}]`,
            requestId
          }
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
    }

    const offering = await platformService.updateOffering({
      ownerUserId: auth.userId,
      offeringId,
      pricingMode: body.pricingMode,
      fixedPricePer1kInput: body.fixedPricePer1kInput,
      fixedPricePer1kOutput: body.fixedPricePer1kOutput,
      enabled: body.enabled,
      dailyTokenLimit: body.dailyTokenLimit,
      maxConcurrency: body.maxConcurrency
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
      return true;
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
      return true;
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
    return true;
  }

  if (req.method === "DELETE" && offeringId) {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
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
      return true;
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
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/offerings") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
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
      return true;
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
      return true;
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
      return true;
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
      return true;
    }

    const guidance = await platformService.getPricingGuidance(body.logicalModel);

    // Read admin defaults from platform_config
    const defaultConcurrency = await platformService.getConfigValue("default_max_concurrency");
    const defaultDailyLimit = await platformService.getConfigValue("default_daily_token_limit");
    const defaultInputPrice = await platformService.getConfigValue("default_input_price_per_1k");
    const defaultOutputPrice = await platformService.getConfigValue("default_output_price_per_1k");

    const fixedPricePer1kInput = (typeof body.fixedPricePer1kInput === "number" && body.fixedPricePer1kInput > 0)
      ? body.fixedPricePer1kInput
      : (defaultInputPrice ? parseFloat(defaultInputPrice) : guidance.inputPricePer1k);
    const fixedPricePer1kOutput = (typeof body.fixedPricePer1kOutput === "number" && body.fixedPricePer1kOutput > 0)
      ? body.fixedPricePer1kOutput
      : (defaultOutputPrice ? parseFloat(defaultOutputPrice) : guidance.outputPricePer1k);
    const maxConcurrency = (typeof body.maxConcurrency === "number" && body.maxConcurrency > 0)
      ? body.maxConcurrency
      : (defaultConcurrency ? parseInt(defaultConcurrency, 10) : undefined);
    const dailyTokenLimit = (typeof body.dailyTokenLimit === "number" && body.dailyTokenLimit > 0)
      ? body.dailyTokenLimit
      : (defaultDailyLimit ? parseInt(defaultDailyLimit, 10) : undefined);

    const minInput = Number(await platformService.getConfigValue("min_input_price_per_1k")) || 0;
    const maxInput = Number(await platformService.getConfigValue("max_input_price_per_1k")) || Infinity;
    const minOutput = Number(await platformService.getConfigValue("min_output_price_per_1k")) || 0;
    const maxOutput = Number(await platformService.getConfigValue("max_output_price_per_1k")) || Infinity;
    if (fixedPricePer1kInput < minInput || fixedPricePer1kInput > maxInput ||
        fixedPricePer1kOutput < minOutput || fixedPricePer1kOutput > maxOutput) {
      const response = json(400, {
        error: {
          code: "price_out_of_range",
          message: `Price must be within configured limits: input [${minInput}, ${maxInput}], output [${minOutput}, ${maxOutput}]`,
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const offering = await platformService.createOffering({
      id: `offering_${randomUUID()}`,
      ownerUserId: auth.userId,
      logicalModel: body.logicalModel,
      credentialId: body.credentialId,
      realModel: body.realModel,
      pricingMode: body.pricingMode ?? "fixed_price",
      fixedPricePer1kInput,
      fixedPricePer1kOutput,
      maxConcurrency,
      dailyTokenLimit
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
    return true;
  }

  return false;
}
