import type {
  CandidateOffering,
  InvitationStats,
  MeProfile,
  PublicChatCompletionsRequest,
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

export type PlatformRepository = {
  authenticate(apiKey: string): MaybePromise<AuthRecord>;
  authenticateSession(sessionToken: string): MaybePromise<SessionAuthRecord>;
  requestLoginCode(email: string): MaybePromise<{
    eligible: boolean;
    firstLogin: boolean;
    code?: string;
  }>;
  verifyLoginCode(email: string, code: string): MaybePromise<VerifyLoginCodeResult>;
  loginWithPassword(email: string, password: string): MaybePromise<VerifyLoginCodeResult>;
  updateMeProfile(params: {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
  }): MaybePromise<MeProfile | null>;
  updateMePassword(params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string }>;
  updateMeEmail(params: {
    userId: string;
    newEmail: string;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string; data?: MeProfile | null }>;
  updateMePhone(params: {
    userId: string;
    phone: string;
  }): MaybePromise<{ ok: boolean; code?: string; message?: string; data?: MeProfile | null }>;
  getMe(userId: string): MaybePromise<MeProfile | null>;
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
  getAdminUsageSummary(): MaybePromise<any>;
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
  findOfferingForModel(logicalModel: string): MaybePromise<any>;
  findOfferingsForModel(logicalModel: string): MaybePromise<any[]>;
  listProviderCredentials(userId: string): MaybePromise<any>;
  getProviderCredential(userId: string, credentialId: string): MaybePromise<any>;
  createProviderCredential(params: {
    id: string;
    ownerUserId: string;
    providerType: CandidateOffering["providerType"];
    baseUrl?: string;
    apiKey: string;
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
  }): MaybePromise<any>;
  updateOffering(params: {
    ownerUserId: string;
    offeringId: string;
    pricingMode?: CandidateOffering["pricingMode"];
    fixedPricePer1kInput?: number;
    fixedPricePer1kOutput?: number;
    enabled?: boolean;
  }): MaybePromise<any>;
  removeOffering(params: {
    ownerUserId: string;
    offeringId: string;
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
  }): MaybePromise<void>;
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
  buildCoreRequest(
    requestId: string,
    requesterUserId: string,
    body: PublicChatCompletionsRequest,
    offerings: CandidateOffering[]
  ): MaybePromise<any>;
  devUserApiKey: string;
  devAdminApiKey: string;
};
