import type {
  CandidateOffering,
  InvitationStats,
  MeProfile,
  PublicMarketModel,
  PublicSupplierOffering,
  PublicSupplierProfile
} from "@xllmapi/shared-types";

export type AuthRecord = {
  userId: string;
  apiKeyId: string;
  label: string;
  role: string;
} | null;

export type SessionAuthRecord = {
  userId: string;
  role: "user" | "admin";
  email: string;
  displayName: string;
  handle: string;
  sessionId: string;
} | null;

type MaybePromise<T> = T | Promise<T>;

export type VerifyLoginCodeResult =
  | {
      ok: true;
      token: string;
      user: MeProfile;
      firstLoginCompleted: boolean;
      initialApiKey?: string | null;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export type RequestLoginCodeResult = {
  eligible: boolean;
  firstLogin: boolean;
  code?: string;
  challengeId?: string | null;
  email: string;
};

export type RequestPasswordResetResult = {
  accepted: boolean;
  email: string;
  token?: string;
  challengeId?: string | null;
  userId?: string | null;
};

export type PlatformRepository = {
  authenticate(apiKey: string): MaybePromise<AuthRecord>;
  authenticateSession(sessionToken: string): MaybePromise<SessionAuthRecord>;
  revokeSession(sessionId: string): MaybePromise<boolean>;
  checkHealth(): MaybePromise<boolean>;
  requestLoginCode(email: string): MaybePromise<RequestLoginCodeResult>;
  verifyLoginCode(email: string, code: string): MaybePromise<VerifyLoginCodeResult>;
  loginWithPassword(email: string, password: string): MaybePromise<VerifyLoginCodeResult>;
  requestPasswordReset(email: string): MaybePromise<RequestPasswordResetResult>;
  resetPassword(params: {
    token: string;
    newPassword: string;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string; data?: { userId: string; sessionsRevoked: number } }>;
  requestEmailChange(params: {
    userId: string;
    newEmail: string;
    currentPassword?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string; data?: { requestId: string; oldEmail: string; newEmail: string; token?: string; challengeId: string } }>;
  confirmEmailChange(params: {
    token: string;
    sessionId?: string | null;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string; data?: { profile: MeProfile | null; oldEmail: string; newEmail: string } }>;
  updateMeProfile(params: {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
  }): MaybePromise<MeProfile | null>;
  updateMePassword(params: {
    userId: string;
    currentSessionId?: string | null;
    currentPassword: string;
    newPassword: string;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string; data?: { sessionsRevoked: number } }>;
  updateMeEmail(params: {
    userId: string;
    newEmail: string;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string; data?: MeProfile | null }>;
  updateMePhone(params: {
    userId: string;
    phone: string;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string; data?: MeProfile | null }>;
  getMe(userId: string): MaybePromise<MeProfile | null>;
  findUserByHandle(handle: string): MaybePromise<{ id: string; displayName: string; handle: string; role: string } | null>;
  listInvitations(userId: string): MaybePromise<any[]>;
  getInvitationStats(userId: string): MaybePromise<InvitationStats>;
  createInvitation(params: {
    inviterUserId: string;
    invitedEmail: string;
    note?: string;
  }): MaybePromise<any>;
  revokeInvitation(params: {
    actorUserId: string;
    invitationId: string;
    isAdmin: boolean;
  }): MaybePromise<any>;
  listAdminInvitations(): MaybePromise<any[]>;
  getAdminAllInvitations(limit?: number): MaybePromise<any[]>;
  listAdminUsers(): MaybePromise<any[]>;
  createAdminInvitation(params: {
    inviterUserId: string;
    invitedEmail: string;
    note?: string;
  }): MaybePromise<any>;
  listMarketModels(): MaybePromise<PublicMarketModel[]>;
  getPublicSupplierProfile(handle: string): MaybePromise<PublicSupplierProfile | null>;
  getPublicSupplierOfferings(handle: string): MaybePromise<PublicSupplierOffering[]>;
  getSupplyUsage(userId: string): MaybePromise<any>;
  getConsumptionUsage(userId: string): MaybePromise<any>;
  getConsumptionDaily(userId: string, year: number): MaybePromise<any[]>;
  getConsumptionByDate(userId: string, date: string): MaybePromise<any[]>;
  getConsumptionRecent(userId: string, days?: number, limit?: number): MaybePromise<any[]>;
  getAdminUsageSummary(days?: number): MaybePromise<any>;
  getWallet(userId: string): MaybePromise<number>;
  listModels(): MaybePromise<PublicMarketModel[]>;
  getDebugState(): MaybePromise<any>;
  writeAuditLog(params: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    payload: unknown;
  }): MaybePromise<void>;
  recordEmailDeliveryAttempt(params: {
    id: string;
    provider: string;
    templateKey: string;
    toEmail: string;
    subject: string;
    challengeId?: string | null;
    status: "queued" | "sent" | "failed" | "delivered" | "bounced" | "complained";
    providerMessageId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    payload?: unknown;
  }): MaybePromise<void>;
  recordSecurityEvent(params: {
    id: string;
    userId: string;
    type: string;
    severity: "info" | "warning" | "critical";
    ipAddress?: string | null;
    userAgent?: string | null;
    payload?: unknown;
  }): MaybePromise<void>;
  listAdminEmailDeliveries(limit: number): MaybePromise<any[]>;
  listAdminSecurityEvents(limit: number): MaybePromise<any[]>;
  findOfferingForModel(logicalModel: string): MaybePromise<any>;
  findOfferingsForModel(logicalModel: string): MaybePromise<any[]>;
  findUserOfferingsForModel(params: { userId: string; logicalModel: string }): MaybePromise<any[]>;
  listProviderCredentials(userId: string): MaybePromise<any>;
  getProviderCredential(userId: string, credentialId: string): MaybePromise<any>;
  createProviderCredential(params: {
    id: string;
    ownerUserId: string;
    providerType: CandidateOffering["providerType"];
    baseUrl?: string;
    anthropicBaseUrl?: string;
    apiKey: string;
    customHeaders?: unknown | null;
    providerLabel?: string | null;
  }): MaybePromise<any>;
  updateProviderCredentialStatus(params: {
    ownerUserId: string;
    credentialId: string;
    status: "active" | "disabled";
  }): MaybePromise<any>;
  removeProviderCredential(params: {
    ownerUserId: string;
    credentialId: string;
  }): MaybePromise<any>;
  deleteProviderCredentialCascade(params: {
    ownerUserId: string;
    credentialId: string;
  }): MaybePromise<any>;
  listOfferings(userId: string): MaybePromise<any>;
  listPendingOfferings(): MaybePromise<any>;
  createOffering(params: {
    id: string;
    ownerUserId: string;
    logicalModel: string;
    credentialId: string;
    realModel: string;
    pricingMode: CandidateOffering["pricingMode"];
    fixedPricePer1kInput: number;
    fixedPricePer1kOutput: number;
    maxConcurrency?: number;
    dailyTokenLimit?: number;
  }): MaybePromise<any>;
  updateOffering(params: {
    ownerUserId: string;
    offeringId: string;
    pricingMode?: CandidateOffering["pricingMode"];
    fixedPricePer1kInput?: number;
    fixedPricePer1kOutput?: number;
    enabled?: boolean;
    dailyTokenLimit?: number;
    maxConcurrency?: number;
    contextLength?: number;
  }): MaybePromise<any>;
  getOfferingDailyTokenUsage(offeringId: string): MaybePromise<number>;
  removeOffering(params: {
    ownerUserId: string;
    offeringId: string;
  }): MaybePromise<any>;
  archiveOffering(params: {
    ownerUserId: string;
    offeringId: string;
    reason: string;
  }): MaybePromise<any>;
  reviewOffering(params: {
    offeringId: string;
    reviewStatus: "approved" | "rejected";
  }): MaybePromise<any>;
  findCachedResponse(params: {
    requesterUserId: string;
    idempotencyKey: string;
  }): MaybePromise<any>;
  recordChatSettlement(params: {
    requestId: string;
    requesterUserId: string;
    supplierUserId: string;
    logicalModel: string;
    idempotencyKey?: string | null;
    offeringId: string;
    provider: string;
    realModel: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    fixedPricePer1kInput: number;
    fixedPricePer1kOutput: number;
    responseBody?: unknown;
    clientIp?: string;
    clientUserAgent?: string;
    upstreamUserAgent?: string;
    apiKeyId?: string;
    providerLabel?: string;
    clientFormat?: string;
    upstreamFormat?: string;
    formatConverted?: boolean;
  }): MaybePromise<void>;
  recordSettlementFailure(params: {
    requestId: string;
    requesterUserId: string;
    supplierUserId: string;
    logicalModel: string;
    idempotencyKey?: string | null;
    offeringId: string;
    provider: string;
    realModel: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    fixedPricePer1kInput: number;
    fixedPricePer1kOutput: number;
    responseBody?: unknown;
    errorMessage: string;
  }): MaybePromise<void>;
  getAdminSettlementFailures(params: {
    page: number;
    limit: number;
    status?: "open" | "resolved" | "all";
  }): MaybePromise<{ data: any[]; total: number }>;
  retrySettlementFailure(params: {
    failureId: string;
    actorUserId: string;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string; data?: any }>;
  createChatConversation(params: {
    id: string;
    ownerUserId: string;
    logicalModel: string;
    title?: string;
  }): MaybePromise<any>;
  getChatConversation(params: {
    ownerUserId: string;
    conversationId: string;
  }): MaybePromise<any>;
  listChatConversations(params: {
    ownerUserId: string;
    logicalModel: string;
    limit?: number;
  }): MaybePromise<any[]>;
  listChatMessages(params: {
    ownerUserId: string;
    conversationId: string;
    limit?: number;
  }): MaybePromise<any[]>;
  appendChatMessage(params: {
    id: string;
    conversationId: string;
    role: "user" | "assistant" | "system";
    content: string;
    requestId?: string | null;
  }): MaybePromise<void>;
  deleteChatConversation(params: {
    conversationId: string;
    ownerUserId: string;
  }): MaybePromise<number>;
  updateChatConversationTitle(params: {
    conversationId: string;
    ownerUserId: string;
    title: string;
  }): MaybePromise<any>;
  getSupplyRecent(userId: string, days?: number, limit?: number): MaybePromise<any[]>;
  getSupplyDaily(userId: string, year: number): MaybePromise<any[]>;
  getNetworkModelStats(): MaybePromise<any[]>;
  getNetworkTrends(days: number): MaybePromise<any[]>;
  getAvgSettlementPrice7d?(): MaybePromise<{ avgInput: number; avgOutput: number } | null>;
  getAdminUsageRecent(limit: number): MaybePromise<any[]>;
  getAdminStats(): MaybePromise<any>;
  updateAdminUser(userId: string, updates: { role?: string; status?: string; walletAdjust?: number }): MaybePromise<any>;
  getAdminProviders(): MaybePromise<any[]>;
  getAdminConfig(): MaybePromise<any[]>;
  getConfigValue(key: string): MaybePromise<string | null>;
  updateAdminConfig(key: string, value: string, updatedBy: string): MaybePromise<any>;
  getAdminAuditLogs(limit: number): MaybePromise<any[]>;
  getAuditLogsByTargetType(targetType: string, limit: number): MaybePromise<any[]>;
  getAdminRequests(params: {
    model?: string;
    provider?: string;
    user?: string;
    days?: number;
    page: number;
    limit: number;
  }): MaybePromise<{ data: any[]; total: number }>;
  getAdminRequestDetail(requestId: string): MaybePromise<any>;
  getAdminOfferingHealthList(): MaybePromise<any[]>;
  adminStopOffering(offeringId: string): MaybePromise<void>;
  recordFailedRequest(params: {
    requestId: string;
    requesterUserId: string;
    logicalModel: string;
    offeringId?: string;
    provider?: string;
    realModel?: string;
    errorMessage: string;
    clientIp?: string;
    clientUserAgent?: string;
    providerLabel?: string;
  }): MaybePromise<void>;
  getAdminSettlements(params: {
    days?: number;
    page: number;
    limit: number;
  }): MaybePromise<{ data: any[]; summary: { totalConsumerCost: number; totalSupplierReward: number; totalPlatformMargin: number; count: number } }>;
  createNotification(params: { id: string; title: string; body: string; type: string; targetUserId?: string | null; createdBy: string }): MaybePromise<any>;
  listAdminNotifications(): MaybePromise<any[]>;
  listUserNotifications(userId: string): MaybePromise<any[]>;
  markNotificationRead(notificationId: string, userId: string): MaybePromise<any>;
  getUnreadCount(userId: string): MaybePromise<number>;

  // --- Platform API Key Methods ---
  createApiKey(params: { userId: string; label: string }): MaybePromise<{ id: string; rawKey: string }>;
  listApiKeys(userId: string): MaybePromise<Array<{ id: string; label: string; keyPrefix: string; status: string; createdAt: string }>>;
  revokeApiKey(params: { userId: string; keyId: string }): MaybePromise<boolean>;

  // --- Node Token Methods ---
  createNodeToken(params: { userId: string; label: string }): MaybePromise<{ id: string; rawToken: string }>;
  listNodeTokens(userId: string): MaybePromise<any[]>;
  revokeNodeToken(params: { userId: string; tokenId: string }): MaybePromise<boolean>;
  authenticateNodeToken(rawToken: string): MaybePromise<{ userId: string; tokenId: string; nodeTokenId: string } | null>;

  // --- Node Instance Methods ---
  upsertNode(params: { nodeId: string; userId: string; tokenId: string; ipAddress?: string; userAgent?: string; capabilities?: any[] }): MaybePromise<void>;
  updateNodeStatus(params: { nodeId: string; status: string; lastHeartbeatAt?: string }): MaybePromise<void>;
  updateNodeCapabilities(params: { nodeId: string; capabilities: any[] }): MaybePromise<void>;
  listUserNodes(userId: string): MaybePromise<any[]>;
  getNode(nodeId: string): MaybePromise<any | null>;
  listOnlineNodes(): MaybePromise<any[]>;
  setNodeOffline(nodeId: string): MaybePromise<void>;
  incrementNodeStats(params: { nodeId: string; success: boolean }): MaybePromise<void>;

  // --- Node Preferences ---
  getNodePreferences(userId: string): MaybePromise<any | null>;
  upsertNodePreferences(params: { userId: string; allowDistributedNodes: boolean; trustMode: string; trustedSupplierIds: string[]; trustedOfferingIds: string[] }): MaybePromise<void>;

  // --- Node Offerings ---
  createNodeOffering(params: { offeringId: string; ownerUserId: string; nodeId: string; logicalModel: string; realModel: string; pricingMode: string; fixedPricePer1kInput: number; fixedPricePer1kOutput: number; description?: string; maxConcurrency?: number }): MaybePromise<void>;
  listNodeOfferings(nodeId: string): MaybePromise<any[]>;
  findOfferingsForModelWithNodes(params: { logicalModel: string; userId?: string }): MaybePromise<any[]>;
  setNodeOfferingsAvailability(params: { nodeId: string; available: boolean }): MaybePromise<void>;
  getNodeByPublicId(publicNodeId: string): MaybePromise<any | null>;

  // --- Social: Votes ---
  castVote(params: { userId: string; offeringId: string; vote: 'upvote' | 'downvote' }): MaybePromise<void>;
  removeVote(params: { userId: string; offeringId: string }): MaybePromise<void>;
  getVoteSummary(offeringId: string, userId?: string): MaybePromise<{ upvotes: number; downvotes: number; myVote: string | null }>;

  // --- Social: Favorites ---
  addFavorite(params: { userId: string; offeringId: string }): MaybePromise<void>;
  removeFavorite(params: { userId: string; offeringId: string }): MaybePromise<void>;
  listFavorites(userId: string): MaybePromise<any[]>;

  // --- Social: Comments ---
  addComment(params: { commentId: string; userId: string; offeringId: string; content: string }): MaybePromise<void>;
  listComments(params: { offeringId: string; limit?: number; offset?: number }): MaybePromise<any[]>;
  deleteComment(params: { commentId: string; userId?: string }): MaybePromise<boolean>;

  // --- Connection Pool ---
  joinConnectionPool(params: { userId: string; offeringId: string }): MaybePromise<void>;
  leaveConnectionPool(params: { userId: string; offeringId: string }): MaybePromise<void>;
  listConnectionPool(userId: string): MaybePromise<any[]>;
  toggleConnectionPoolPause(params: { userId: string; offeringId: string; paused: boolean }): MaybePromise<void>;

  // --- Connection Pool (model-level) ---
  joinModelPool(params: { userId: string; logicalModel: string }): MaybePromise<void>;
  leaveModelPool(params: { userId: string; logicalModel: string }): MaybePromise<void>;
  isModelInPool(params: { userId: string; logicalModel: string }): MaybePromise<boolean>;
  removeModelPool(params: { userId: string; logicalModel: string }): MaybePromise<void>;
  listConnectionPoolGrouped(userId: string): MaybePromise<Array<{
    logicalModel: string;
    offeringCount: number;
    minInputPrice: number;
    minOutputPrice: number;
    executionMode: string;
    paused: boolean;
    totalRequests: number;
    totalTokens: number;
  }>>;

  // --- User Model Config ---
  getUserModelConfig(params: { userId: string; logicalModel: string }): MaybePromise<{ maxInputPrice: number | null; maxOutputPrice: number | null } | null>;
  upsertUserModelConfig(params: { userId: string; logicalModel: string; maxInputPrice: number | null; maxOutputPrice: number | null }): MaybePromise<void>;

  // --- Provider Presets ---
  listProviderPresets(): MaybePromise<Array<{
    id: string; label: string; providerType: string; baseUrl: string;
    anthropicBaseUrl: string | null; models: unknown[]; enabled: boolean;
    sortOrder: number; updatedAt: string; updatedBy: string | null;
    customHeaders: unknown | null;
  }>>;
  upsertProviderPreset(params: {
    id: string; label: string; providerType: string; baseUrl: string;
    anthropicBaseUrl?: string | null; models: unknown[]; enabled?: boolean;
    sortOrder?: number; updatedBy?: string; customHeaders?: unknown | null;
  }): MaybePromise<void>;
  deleteProviderPreset(id: string): MaybePromise<boolean>;

  // --- Market ---
  listMarketOfferings(params: { page?: number; limit?: number; executionMode?: string; logicalModel?: string; sort?: string }): MaybePromise<{ data: any[]; total: number }>;
  getMarketOffering(params: { offeringId: string; userId?: string }): MaybePromise<any | null>;

  // --- User Profile ---
  getPublicUserProfile(handle: string): MaybePromise<any | null>;
  listUserOfferings(handle: string): MaybePromise<any[]>;

  devUserApiKey: string;
  devAdminApiKey: string;
};
