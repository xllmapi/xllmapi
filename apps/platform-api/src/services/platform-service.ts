import type {
  CandidateOffering
} from "@xllmapi/shared-types";

import { platformRepository } from "../repositories/index.js";

type ProviderPreset = {
  id: string;
  label: string;
  providerType: CandidateOffering["providerType"];
  baseUrl: string;
  logicalModel: string;
  realModel: string;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek (OpenAI-compatible)",
    providerType: "openai_compatible",
    baseUrl: "https://api.deepseek.com",
    logicalModel: "deepseek-chat",
    realModel: "deepseek-chat"
  },
  {
    id: "openai",
    label: "OpenAI",
    providerType: "openai",
    baseUrl: "https://api.openai.com/v1",
    logicalModel: "gpt-4o-mini",
    realModel: "gpt-4o-mini"
  },
  {
    id: "anthropic",
    label: "Anthropic",
    providerType: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    logicalModel: "claude-sonnet-4-20250514",
    realModel: "claude-sonnet-4-20250514"
  }
];

const with_timeout_ = async <T>(task: Promise<T>, ms = 8000): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await task;
  } finally {
    clearTimeout(timer);
  }
};

const validate_provider_connectivity_ = async (params: {
  providerType: CandidateOffering["providerType"];
  baseUrl: string;
  apiKey: string;
  testModel?: string;
}) => {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const timeoutMs = 8000;
  const testMessage = "ping";

  if (params.providerType === "anthropic") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": params.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: params.testModel || "claude-sonnet-4-20250514",
          max_tokens: 8,
          messages: [{ role: "user", content: testMessage }]
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.text();
        return {
          ok: false as const,
          message: `anthropic connectivity check failed (${response.status})`,
          details: body.slice(0, 300)
        };
      }
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: "anthropic connectivity check error", details: String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const defaultModel = params.providerType === "openai_compatible" ? "deepseek-chat" : "gpt-4o-mini";
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: params.testModel || defaultModel,
        messages: [{ role: "user", content: testMessage }],
        max_tokens: 8
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false as const,
        message: `provider connectivity check failed (${response.status})`,
        details: body.slice(0, 300)
      };
    }
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: "provider connectivity check error", details: String(error) };
  } finally {
    clearTimeout(timer);
  }
};

export const platformService = {
  listProviderCatalog() {
    return PROVIDER_PRESETS;
  },

  getProviderPresetById(id: string) {
    return PROVIDER_PRESETS.find((item) => item.id === id) ?? null;
  },

  validateProviderCredential(params: {
    providerType: CandidateOffering["providerType"];
    baseUrl: string;
    apiKey: string;
    testModel?: string;
  }) {
    return validate_provider_connectivity_(params);
  },

  async getPricingGuidance(logicalModel: string) {
    const normalizedModel = logicalModel.trim();
    const defaults = (() => {
      if (normalizedModel.includes("deepseek")) {
        return { inputPricePer1k: 300, outputPricePer1k: 500, source: "default_profile" as const };
      }
      if (normalizedModel.includes("claude")) {
        return { inputPricePer1k: 1500, outputPricePer1k: 3000, source: "default_profile" as const };
      }
      if (normalizedModel.includes("openai")) {
        return { inputPricePer1k: 1000, outputPricePer1k: 2000, source: "default_profile" as const };
      }
      return { inputPricePer1k: 1000, outputPricePer1k: 2000, source: "default_profile" as const };
    })();

    const marketModels = await platformRepository.listMarketModels();
    const marketModel = marketModels.find((item) => item.logicalModel === normalizedModel);

    const hasMarketInput = Number.isFinite(Number(marketModel?.minInputPrice)) && Number(marketModel?.minInputPrice) > 0;
    const hasMarketOutput = Number.isFinite(Number(marketModel?.minOutputPrice)) && Number(marketModel?.minOutputPrice) > 0;

    const inputPricePer1k = hasMarketInput ? Number(marketModel?.minInputPrice) : defaults.inputPricePer1k;
    const outputPricePer1k = hasMarketOutput ? Number(marketModel?.minOutputPrice) : defaults.outputPricePer1k;

    return {
      logicalModel: normalizedModel,
      inputPricePer1k,
      outputPricePer1k,
      source: hasMarketInput || hasMarketOutput ? "market_reference" : defaults.source,
      marketMinInputPricePer1k: hasMarketInput ? Number(marketModel?.minInputPrice) : null,
      marketMinOutputPricePer1k: hasMarketOutput ? Number(marketModel?.minOutputPrice) : null
    };
  },

  authenticate(apiKey: string) {
    return platformRepository.authenticate(apiKey);
  },

  authenticateSession(sessionToken: string) {
    return platformRepository.authenticateSession(sessionToken);
  },

  requestLoginCode(email: string) {
    return platformRepository.requestLoginCode(email);
  },

  verifyLoginCode(email: string, code: string) {
    return platformRepository.verifyLoginCode(email, code);
  },

  loginWithPassword(email: string, password: string) {
    return platformRepository.loginWithPassword(email, password);
  },

  updateMeProfile(params: {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
  }) {
    return platformRepository.updateMeProfile(params);
  },

  updateMePassword(params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }) {
    return platformRepository.updateMePassword(params);
  },

  updateMeEmail(params: {
    userId: string;
    newEmail: string;
  }) {
    return platformRepository.updateMeEmail(params);
  },

  updateMePhone(params: {
    userId: string;
    phone: string;
  }) {
    return platformRepository.updateMePhone(params);
  },

  getMe(userId: string) {
    return platformRepository.getMe(userId);
  },

  listInvitations(userId: string) {
    return platformRepository.listInvitations(userId);
  },

  getInvitationStats(userId: string) {
    return platformRepository.getInvitationStats(userId);
  },

  createInvitation(params: {
    inviterUserId: string;
    invitedEmail: string;
    note?: string;
  }) {
    return platformRepository.createInvitation(params);
  },

  revokeInvitation(params: {
    actorUserId: string;
    invitationId: string;
    isAdmin: boolean;
  }) {
    return platformRepository.revokeInvitation(params);
  },

  listAdminInvitations() {
    return platformRepository.listAdminInvitations();
  },

  listAdminUsers() {
    return platformRepository.listAdminUsers();
  },

  createAdminInvitation(params: {
    inviterUserId: string;
    invitedEmail: string;
    note?: string;
  }) {
    return platformRepository.createAdminInvitation(params);
  },

  listMarketModels() {
    return platformRepository.listMarketModels();
  },

  getPublicSupplierProfile(handle: string) {
    return platformRepository.getPublicSupplierProfile(handle);
  },

  getPublicSupplierOfferings(handle: string) {
    return platformRepository.getPublicSupplierOfferings(handle);
  },

  getSupplyUsage(userId: string) {
    return platformRepository.getSupplyUsage(userId);
  },

  getConsumptionUsage(userId: string) {
    return platformRepository.getConsumptionUsage(userId);
  },

  getConsumptionDaily(userId: string, year: number) {
    return platformRepository.getConsumptionDaily(userId, year);
  },

  getConsumptionByDate(userId: string, date: string) {
    return platformRepository.getConsumptionByDate(userId, date);
  },

  getConsumptionRecent(userId: string, days?: number, limit?: number) {
    return platformRepository.getConsumptionRecent(userId, days, limit);
  },

  getAdminUsageSummary() {
    return platformRepository.getAdminUsageSummary();
  },

  getWallet(userId: string) {
    return platformRepository.getWallet(userId);
  },

  listModels() {
    return platformRepository.listModels();
  },

  getDebugState() {
    return platformRepository.getDebugState();
  },

  writeAuditLog(params: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    payload: unknown;
  }) {
    return platformRepository.writeAuditLog(params);
  },

  findOfferingForModel(logicalModel: string) {
    return platformRepository.findOfferingForModel(logicalModel);
  },

  findOfferingsForModel(logicalModel: string) {
    return platformRepository.findOfferingsForModel(logicalModel);
  },

  listProviderCredentials(userId: string) {
    return platformRepository.listProviderCredentials(userId);
  },

  getProviderCredential(userId: string, credentialId: string) {
    return platformRepository.getProviderCredential(userId, credentialId);
  },

  createProviderCredential(params: {
    id: string;
    ownerUserId: string;
    providerType: CandidateOffering["providerType"];
    baseUrl?: string;
    apiKey: string;
  }) {
    return platformRepository.createProviderCredential(params);
  },

  updateProviderCredentialStatus(params: {
    ownerUserId: string;
    credentialId: string;
    status: "active" | "disabled";
  }) {
    return platformRepository.updateProviderCredentialStatus(params);
  },

  removeProviderCredential(params: {
    ownerUserId: string;
    credentialId: string;
  }) {
    return platformRepository.removeProviderCredential(params);
  },

  listOfferings(userId: string) {
    return platformRepository.listOfferings(userId);
  },

  listPendingOfferings() {
    return platformRepository.listPendingOfferings();
  },

  createOffering(params: {
    id: string;
    ownerUserId: string;
    logicalModel: string;
    credentialId: string;
    realModel: string;
    pricingMode: CandidateOffering["pricingMode"];
    fixedPricePer1kInput: number;
    fixedPricePer1kOutput: number;
  }) {
    return platformRepository.createOffering(params);
  },

  updateOffering(params: {
    ownerUserId: string;
    offeringId: string;
    pricingMode?: CandidateOffering["pricingMode"];
    fixedPricePer1kInput?: number;
    fixedPricePer1kOutput?: number;
    enabled?: boolean;
  }) {
    return platformRepository.updateOffering(params);
  },

  removeOffering(params: {
    ownerUserId: string;
    offeringId: string;
  }) {
    return platformRepository.removeOffering(params);
  },

  reviewOffering(params: {
    offeringId: string;
    reviewStatus: "approved" | "rejected";
  }) {
    return platformRepository.reviewOffering(params);
  },

  findCachedResponse(params: {
    requesterUserId: string;
    idempotencyKey: string;
  }) {
    return platformRepository.findCachedResponse(params);
  },

  createChatConversation(params: {
    id: string;
    ownerUserId: string;
    logicalModel: string;
    title?: string;
  }) {
    return platformRepository.createChatConversation(params);
  },

  getChatConversation(params: {
    ownerUserId: string;
    conversationId: string;
  }) {
    return platformRepository.getChatConversation(params);
  },

  listChatConversations(params: {
    ownerUserId: string;
    logicalModel: string;
    limit?: number;
  }) {
    return platformRepository.listChatConversations(params);
  },

  listChatMessages(params: {
    ownerUserId: string;
    conversationId: string;
    limit?: number;
  }) {
    return platformRepository.listChatMessages(params);
  },

  appendChatMessage(params: {
    id: string;
    conversationId: string;
    role: "user" | "assistant" | "system";
    content: string;
    requestId?: string | null;
  }) {
    return platformRepository.appendChatMessage(params);
  },

  deleteChatConversation(params: {
    conversationId: string;
    ownerUserId: string;
  }) {
    return platformRepository.deleteChatConversation(params);
  },

  updateChatConversationTitle(params: {
    conversationId: string;
    ownerUserId: string;
    title: string;
  }) {
    return platformRepository.updateChatConversationTitle(params);
  },

  recordChatSettlement: platformRepository.recordChatSettlement
};
