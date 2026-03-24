import crypto from "crypto";

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
  // DeepSeek
  {
    id: "deepseek",
    label: "DeepSeek",
    providerType: "openai_compatible",
    baseUrl: "https://api.deepseek.com",
    logicalModel: "deepseek-chat",
    realModel: "deepseek-chat"
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    providerType: "openai_compatible",
    baseUrl: "https://api.deepseek.com",
    logicalModel: "deepseek-reasoner",
    realModel: "deepseek-reasoner"
  },
  // OpenAI
  {
    id: "openai",
    label: "OpenAI",
    providerType: "openai",
    baseUrl: "https://api.openai.com/v1",
    logicalModel: "gpt-4o-mini",
    realModel: "gpt-4o-mini"
  },
  {
    id: "openai",
    label: "OpenAI",
    providerType: "openai",
    baseUrl: "https://api.openai.com/v1",
    logicalModel: "gpt-4o",
    realModel: "gpt-4o"
  },
  // Anthropic
  {
    id: "anthropic",
    label: "Anthropic",
    providerType: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    logicalModel: "claude-sonnet-4-20250514",
    realModel: "claude-sonnet-4-20250514"
  },
  // Kimi / Moonshot
  {
    id: "kimi",
    label: "Kimi / Moonshot",
    providerType: "openai_compatible",
    baseUrl: "https://api.moonshot.ai/v1",
    logicalModel: "moonshot-v1-8k",
    realModel: "moonshot-v1-8k"
  },
  {
    id: "kimi",
    label: "Kimi / Moonshot",
    providerType: "openai_compatible",
    baseUrl: "https://api.moonshot.ai/v1",
    logicalModel: "moonshot-v1-32k",
    realModel: "moonshot-v1-32k"
  },
  {
    id: "kimi-coding",
    label: "Kimi Coding",
    providerType: "openai_compatible",
    baseUrl: "https://api.kimi.com/coding/v1",
    logicalModel: "kimi-for-coding",
    realModel: "kimi-for-coding"
  },
  // MiniMax (China: api.minimaxi.com, Global: api.minimax.io)
  {
    id: "minimax",
    label: "MiniMax",
    providerType: "openai_compatible",
    baseUrl: "https://api.minimaxi.com/v1",
    logicalModel: "MiniMax-M2.7",
    realModel: "MiniMax-M2.7"
  },
  {
    id: "minimax",
    label: "MiniMax",
    providerType: "openai_compatible",
    baseUrl: "https://api.minimaxi.com/v1",
    logicalModel: "MiniMax-M2.5",
    realModel: "MiniMax-M2.5"
  },
  {
    id: "minimax",
    label: "MiniMax",
    providerType: "openai_compatible",
    baseUrl: "https://api.minimaxi.com/v1",
    logicalModel: "MiniMax-Text-01",
    realModel: "MiniMax-Text-01"
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
    const chatUrl = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/chat/completions`;
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "content-type": "application/json",
        "user-agent": "claude-code/1.0"
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
  /** Direct access to the underlying repository (used by node-connection-manager, etc.) */
  repo: platformRepository,

  listProviderCatalog() {
    return PROVIDER_PRESETS;
  },

  getProviderPresetById(id: string) {
    return PROVIDER_PRESETS.find((item) => item.id === id) ?? null;
  },

  async discoverProviderModels(params: {
    providerType: CandidateOffering["providerType"];
    baseUrl: string;
    apiKey: string;
  }): Promise<{ ok: boolean; models?: { id: string; name?: string }[]; message?: string }> {
    const baseUrl = params.baseUrl.replace(/\/+$/, "");
    const timeoutMs = 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (params.providerType === "anthropic") {
        const response = await fetch(`${baseUrl}/models?limit=100`, {
          headers: {
            "x-api-key": params.apiKey,
            "anthropic-version": "2023-06-01"
          },
          signal: controller.signal
        });
        if (!response.ok) {
          return { ok: false, message: `Failed to list models (${response.status})` };
        }
        const body = await response.json() as { data?: { id: string; display_name?: string }[] };
        const models = (body.data ?? []).map((m) => ({ id: m.id, name: m.display_name }));
        return { ok: true, models };
      }

      // OpenAI / OpenAI-compatible
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${params.apiKey}` },
        signal: controller.signal
      });
      if (!response.ok) {
        return { ok: false, message: `Failed to list models (${response.status})` };
      }
      const body = await response.json() as { data?: { id: string; name?: string }[] };
      const models = (body.data ?? []).map((m) => ({ id: m.id, name: m.name }));
      return { ok: true, models };
    } catch (error) {
      return { ok: false, message: `Model discovery failed: ${String(error)}` };
    } finally {
      clearTimeout(timer);
    }
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
      if (normalizedModel.toLowerCase().includes("deepseek")) {
        return { inputPricePer1k: 300, outputPricePer1k: 500, source: "default_profile" as const };
      }
      if (normalizedModel.toLowerCase().includes("minimax")) {
        return { inputPricePer1k: 500, outputPricePer1k: 800, source: "default_profile" as const };
      }
      if (normalizedModel.toLowerCase().includes("claude")) {
        return { inputPricePer1k: 1500, outputPricePer1k: 3000, source: "default_profile" as const };
      }
      if (normalizedModel.toLowerCase().includes("gpt") || normalizedModel.toLowerCase().includes("openai")) {
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

    // Compute platform-wide min/max/avg from all active offerings
    const allModels = marketModels.filter((m) => !m.logicalModel.startsWith("community-") && !m.logicalModel.startsWith("e2e-"));
    let platformMinInput = Infinity, platformMaxInput = 0;
    let platformMinOutput = Infinity, platformMaxOutput = 0;
    for (const m of allModels) {
      const inp = Number(m.minInputPrice);
      const out = Number(m.minOutputPrice);
      if (inp > 0) { platformMinInput = Math.min(platformMinInput, inp); platformMaxInput = Math.max(platformMaxInput, inp); }
      if (out > 0) { platformMinOutput = Math.min(platformMinOutput, out); platformMaxOutput = Math.max(platformMaxOutput, out); }
    }
    if (!Number.isFinite(platformMinInput)) platformMinInput = 0;
    if (!Number.isFinite(platformMinOutput)) platformMinOutput = 0;

    // 7-day average effective price from actual settlements
    const avgPrice = await platformRepository.getAvgSettlementPrice7d?.() ?? null;

    return {
      logicalModel: normalizedModel,
      inputPricePer1k,
      outputPricePer1k,
      source: hasMarketInput || hasMarketOutput ? "market_reference" : defaults.source,
      marketMinInputPricePer1k: hasMarketInput ? Number(marketModel?.minInputPrice) : null,
      marketMinOutputPricePer1k: hasMarketOutput ? Number(marketModel?.minOutputPrice) : null,
      platformMinInput,
      platformMaxInput,
      platformMinOutput,
      platformMaxOutput,
      avg7dInputPricePer1k: avgPrice?.avgInput ?? null,
      avg7dOutputPricePer1k: avgPrice?.avgOutput ?? null
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

  getAdminUsageSummary(days?: number) {
    return platformRepository.getAdminUsageSummary(days);
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

  findUserOfferingsForModel(userId: string, logicalModel: string) {
    return platformRepository.findUserOfferingsForModel({ userId, logicalModel });
  },

  findOfferingsForModelWithNodes(params: { logicalModel: string; userId?: string }) {
    return platformRepository.findOfferingsForModelWithNodes(params);
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
    dailyTokenLimit?: number;
    maxConcurrency?: number;
  }) {
    return platformRepository.updateOffering(params);
  },

  async getOfferingDailyTokenUsage(offeringId: string): Promise<number> {
    return platformRepository.getOfferingDailyTokenUsage(offeringId);
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

  recordChatSettlement: platformRepository.recordChatSettlement,

  async getSupplyRecent(userId: string, days?: number, limit?: number): Promise<any[]> {
    return platformRepository.getSupplyRecent(userId, days, limit);
  },

  async getSupplyDaily(userId: string, year: number): Promise<any[]> {
    return platformRepository.getSupplyDaily(userId, year);
  },

  async getNetworkModelStats(): Promise<any[]> {
    return platformRepository.getNetworkModelStats();
  },

  async getNetworkTrends(days: number): Promise<any[]> {
    return platformRepository.getNetworkTrends(days);
  },

  getAdminUsageRecent(limit: number) {
    return platformRepository.getAdminUsageRecent(limit);
  },

  getAdminStats() {
    return platformRepository.getAdminStats();
  },

  updateAdminUser(userId: string, updates: { role?: string; status?: string; walletAdjust?: number }) {
    return platformRepository.updateAdminUser(userId, updates);
  },

  getAdminProviders() {
    return platformRepository.getAdminProviders();
  },

  getAdminConfig() {
    return platformRepository.getAdminConfig();
  },

  updateAdminConfig(key: string, value: string, updatedBy: string) {
    return platformRepository.updateAdminConfig(key, value, updatedBy);
  },

  getAdminAuditLogs(limit: number) {
    return platformRepository.getAdminAuditLogs(limit);
  },

  createNotification(params: { id: string; title: string; body: string; type: string; targetUserId?: string | null; createdBy: string }) {
    return platformRepository.createNotification(params);
  },

  listAdminNotifications() {
    return platformRepository.listAdminNotifications();
  },

  listUserNotifications(userId: string) {
    return platformRepository.listUserNotifications(userId);
  },

  markNotificationRead(notificationId: string, userId: string) {
    return platformRepository.markNotificationRead(notificationId, userId);
  },

  getUnreadCount(userId: string) {
    return platformRepository.getUnreadCount(userId);
  },

  // Platform API Keys
  async createApiKey(userId: string, label: string) {
    return platformRepository.createApiKey({ userId, label });
  },
  async listApiKeys(userId: string) {
    return platformRepository.listApiKeys(userId);
  },
  async revokeApiKey(userId: string, keyId: string) {
    return platformRepository.revokeApiKey({ userId, keyId });
  },

  // Node tokens
  async createNodeToken(userId: string, label: string) {
    return platformRepository.createNodeToken({ userId, label });
  },
  async listNodeTokens(userId: string) {
    return platformRepository.listNodeTokens(userId);
  },
  async revokeNodeToken(userId: string, tokenId: string) {
    return platformRepository.revokeNodeToken({ userId, tokenId });
  },

  // Nodes
  async listUserNodes(userId: string) {
    return platformRepository.listUserNodes(userId);
  },
  async getNodeStats(nodeId: string) {
    return platformRepository.getNode(nodeId);
  },
  async getNode(nodeId: string) {
    return platformRepository.getNode(nodeId);
  },
  async createNodeOffering(params: { offeringId: string; ownerUserId: string; nodeId: string; logicalModel: string; realModel: string; pricingMode: string; fixedPricePer1kInput: number; fixedPricePer1kOutput: number }) {
    return platformRepository.createNodeOffering(params);
  },
  async getNodeByPublicId(publicNodeId: string) {
    return platformRepository.getNodeByPublicId(publicNodeId);
  },
  async listNodeOfferings(nodeId: string) {
    return platformRepository.listNodeOfferings(nodeId);
  },

  // Preferences
  async getNodePreferences(userId: string) {
    return platformRepository.getNodePreferences(userId);
  },
  async updateNodePreferences(userId: string, prefs: { allowDistributedNodes: boolean; trustMode: string; trustedSupplierIds: string[]; trustedOfferingIds: string[] }) {
    return platformRepository.upsertNodePreferences({ userId, ...prefs });
  },

  // Votes
  async castVote(userId: string, offeringId: string, vote: 'upvote' | 'downvote') {
    return platformRepository.castVote({ userId, offeringId, vote });
  },
  async removeVote(userId: string, offeringId: string) {
    return platformRepository.removeVote({ userId, offeringId });
  },
  async getVoteSummary(offeringId: string, userId?: string) {
    return platformRepository.getVoteSummary(offeringId, userId);
  },

  // Favorites
  async addFavorite(userId: string, offeringId: string) {
    return platformRepository.addFavorite({ userId, offeringId });
  },
  async removeFavorite(userId: string, offeringId: string) {
    return platformRepository.removeFavorite({ userId, offeringId });
  },
  async listFavorites(userId: string) {
    return platformRepository.listFavorites(userId);
  },

  // Comments
  async addComment(userId: string, offeringId: string, content: string) {
    const commentId = 'cmt_' + crypto.randomUUID();
    await platformRepository.addComment({ commentId, userId, offeringId, content });
    return { id: commentId };
  },
  async listComments(offeringId: string, page?: number, limit?: number) {
    return platformRepository.listComments({ offeringId, limit: limit ?? 20, offset: ((page ?? 1) - 1) * (limit ?? 20) });
  },
  async deleteComment(userId: string, commentId: string) {
    return platformRepository.deleteComment({ commentId, userId });
  },
  async adminDeleteComment(commentId: string) {
    return platformRepository.deleteComment({ commentId });
  },

  // Connection Pool
  async joinConnectionPool(userId: string, offeringId: string) {
    return platformRepository.joinConnectionPool({ userId, offeringId });
  },
  async leaveConnectionPool(userId: string, offeringId: string) {
    return platformRepository.leaveConnectionPool({ userId, offeringId });
  },
  async toggleConnectionPoolPause(userId: string, offeringId: string, paused: boolean) {
    return platformRepository.toggleConnectionPoolPause({ userId, offeringId, paused });
  },
  async listConnectionPool(userId: string) {
    return platformRepository.listConnectionPool(userId);
  },
  async joinModelPool(userId: string, logicalModel: string) {
    return platformRepository.joinModelPool({ userId, logicalModel });
  },
  async leaveModelPool(userId: string, logicalModel: string) {
    return platformRepository.leaveModelPool({ userId, logicalModel });
  },
  async removeModelPool(userId: string, logicalModel: string) {
    return platformRepository.removeModelPool({ userId, logicalModel });
  },
  async isModelInPool(userId: string, logicalModel: string) {
    return platformRepository.isModelInPool({ userId, logicalModel });
  },
  async listConnectionPoolGrouped(userId: string) {
    return platformRepository.listConnectionPoolGrouped(userId);
  },

  // Market
  async listMarketOfferings(params: { page?: number; limit?: number; executionMode?: string; logicalModel?: string; sort?: string }) {
    return platformRepository.listMarketOfferings(params);
  },
  async getMarketOffering(offeringId: string, userId?: string) {
    return platformRepository.getMarketOffering({ offeringId, userId });
  },

  // User Profiles
  async getPublicUserProfile(handle: string) {
    return platformRepository.getPublicUserProfile(handle);
  },
  async listUserOfferings(handle: string) {
    return platformRepository.listUserOfferings(handle);
  },

  // User Model Config
  async getUserModelConfig(userId: string, logicalModel: string) {
    return platformRepository.getUserModelConfig({ userId, logicalModel });
  },
  async upsertUserModelConfig(userId: string, logicalModel: string, maxInputPrice: number | null, maxOutputPrice: number | null) {
    return platformRepository.upsertUserModelConfig({ userId, logicalModel, maxInputPrice, maxOutputPrice });
  }
};
