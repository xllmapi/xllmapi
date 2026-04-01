import type {
  CandidateOffering
} from "@xllmapi/shared-types";

import {
  create_invitation,
  create_chat_conversation,
  create_offering,
  create_provider_credential,
  find_cached_response,
  get_chat_conversation,
  find_user_by_session_token,
  revoke_session,
  find_user_by_api_key,
  get_admin_usage_summary,
  get_debug_state,
  get_invitation_stats,
  get_me,
  login_with_password,
  get_offering_for_model,
  get_public_supplier_offerings,
  get_public_supplier_profile,
  get_consumption_usage,
  get_consumption_daily,
  get_consumption_by_date,
  get_consumption_recent,
  get_supply_usage,
  list_offerings_for_model,
  get_provider_credential_by_id,
  get_wallet_balance,
  list_active_models,
  list_admin_email_deliveries,
  list_chat_conversations,
  list_chat_messages,
  list_admin_invitations,
  list_admin_security_events,
  list_admin_users,
  list_invitations,
  list_offerings,
  list_pending_offerings,
  list_provider_credentials,
  record_chat_settlement,
  record_settlement_failure,
  list_admin_settlement_failures,
  retry_settlement_failure,
  append_chat_message,
  delete_chat_conversation,
  update_chat_conversation_title,
  request_login_code,
  request_password_reset,
  remove_offering,
  remove_provider_credential,
  revoke_invitation,
  record_email_delivery_attempt,
  record_security_event,
  request_email_change,
  reset_password,
  review_offering,
  update_offering,
  update_provider_credential_status,
  update_me_profile,
  update_me_password,
  update_me_email,
  update_me_phone,
  confirm_email_change,
  verify_login_code,
  write_audit_log,
  get_config_value
} from "../db.js";
import { DEV_ADMIN_API_KEY, DEV_USER_API_KEY } from "../constants.js";
import type { PlatformRepository } from "./platform-repository.js";

export const sqlitePlatformRepository: PlatformRepository = {
  authenticate(apiKey) {
    return find_user_by_api_key(apiKey);
  },

  authenticateSession(sessionToken) {
    return find_user_by_session_token(sessionToken);
  },

  revokeSession(sessionId) {
    return revoke_session(sessionId);
  },

  checkHealth() {
    return true;
  },

  requestLoginCode(email) {
    return request_login_code(email);
  },

  verifyLoginCode(email, code) {
    return verify_login_code(email, code);
  },

  loginWithPassword(email, password) {
    return login_with_password(email, password);
  },

  requestPasswordReset(email) {
    return request_password_reset(email);
  },

  resetPassword(params) {
    return reset_password(params);
  },

  requestEmailChange(params) {
    return request_email_change(params);
  },

  confirmEmailChange(params) {
    return confirm_email_change(params);
  },

  updateMeProfile(params) {
    return update_me_profile(params);
  },

  updateMePassword(params) {
    return update_me_password(params);
  },

  updateMeEmail(params) {
    return update_me_email(params);
  },

  updateMePhone(params) {
    return update_me_phone(params);
  },

  getMe(userId) {
    return get_me(userId);
  },

  findUserByHandle() {
    return null;
  },

  getUserEmailByUserId() {
    return null;
  },

  listInvitations(userId) {
    return list_invitations(userId);
  },

  getInvitationStats(userId) {
    return get_invitation_stats(userId);
  },

  createInvitation(params) {
    return create_invitation(params);
  },

  revokeInvitation(params) {
    return revoke_invitation(params);
  },

  listAdminInvitations() {
    return list_admin_invitations();
  },

  getAdminAllInvitations() { return []; },

  listAdminUsers() {
    return list_admin_users();
  },

  createAdminInvitation(params) {
    return create_invitation(params);
  },

  listMarketModels() {
    return list_active_models();
  },

  getPublicSupplierProfile(handle) {
    return get_public_supplier_profile(handle);
  },

  getPublicSupplierOfferings(handle) {
    return get_public_supplier_offerings(handle);
  },

  getSupplyUsage(userId) {
    return get_supply_usage(userId);
  },

  getConsumptionUsage(userId) {
    return get_consumption_usage(userId);
  },

  getConsumptionDaily(userId, year) {
    return get_consumption_daily(userId, year);
  },

  getConsumptionByDate(userId, date) {
    return get_consumption_by_date(userId, date);
  },

  getConsumptionRecent(userId, days, limit) {
    return get_consumption_recent(userId, days, limit);
  },

  getAdminUsageSummary() {
    return get_admin_usage_summary();
  },

  getWallet(userId) {
    return get_wallet_balance(userId);
  },

  listModels() {
    return list_active_models();
  },

  getDebugState() {
    return get_debug_state();
  },

  writeAuditLog(params) {
    write_audit_log(params);
  },

  recordEmailDeliveryAttempt(params) {
    record_email_delivery_attempt(params);
  },

  recordSecurityEvent(params) {
    record_security_event(params);
  },

  listAdminEmailDeliveries(limit) {
    return list_admin_email_deliveries(limit);
  },

  listAdminSecurityEvents(limit) {
    return list_admin_security_events(limit);
  },

  findOfferingForModel(logicalModel) {
    return get_offering_for_model(logicalModel);
  },

  findOfferingsForModel(logicalModel) {
    return list_offerings_for_model(logicalModel);
  },

  findUserOfferingsForModel() {
    return [];
  },

  listProviderCredentials(userId) {
    return list_provider_credentials(userId);
  },

  getProviderCredential(userId, credentialId) {
    return get_provider_credential_by_id(userId, credentialId);
  },

  createProviderCredential(params) {
    return create_provider_credential(params);
  },

  updateProviderCredentialStatus(params) {
    return update_provider_credential_status(params);
  },

  removeProviderCredential(params) {
    return remove_provider_credential(params);
  },

  listOfferings(userId) {
    return list_offerings(userId);
  },

  listPendingOfferings() {
    return list_pending_offerings();
  },

  createOffering(params) {
    return create_offering(params);
  },

  updateOffering(params) {
    return update_offering(params);
  },

  getOfferingDailyTokenUsage(_offeringId: string): number {
    return 0; // SQLite dev mode: no daily limit tracking
  },

  removeOffering(params) {
    return remove_offering(params);
  },

  reviewOffering(params) {
    return review_offering(params);
  },

  findCachedResponse(params) {
    return find_cached_response(params);
  },

  recordChatSettlement(params) {
    record_chat_settlement(params);
  },

  recordSettlementFailure(params) {
    record_settlement_failure(params);
  },

  createChatConversation(params) {
    return create_chat_conversation(params);
  },

  getChatConversation(params) {
    return get_chat_conversation(params);
  },

  listChatConversations(params) {
    return list_chat_conversations(params);
  },

  listChatMessages(params) {
    return list_chat_messages(params);
  },

  appendChatMessage(params) {
    append_chat_message(params);
  },

  deleteChatConversation(params) {
    return delete_chat_conversation(params);
  },

  updateChatConversationTitle(params) {
    return update_chat_conversation_title(params);
  },

  getSupplyRecent() {
    return [];
  },

  getSupplyDaily() {
    return [];
  },

  getNetworkModelStats() {
    return [];
  },

  getNetworkTrends() {
    return [];
  },

  getAdminUsageRecent() {
    return [];
  },

  getAdminStats() {
    const openFailures = list_admin_settlement_failures({ page: 1, limit: 1000, status: "open" }).total;
    return { activeUsers: 0, openSettlementFailures: openFailures };
  },

  updateAdminUser(_userId: string, _updates: { role?: string; status?: string; walletAdjust?: number; walletAdjustNote?: string }, _actorUserId?: string) {
    return { ok: true };
  },

  getAdminProviders() {
    return [];
  },

  getAdminConfig() {
    return [];
  },

  getConfigValue(key: string) {
    return get_config_value(key);
  },

  updateAdminConfig() {
    return { ok: true };
  },

  getAdminAuditLogs() {
    return [];
  },

  getAuditLogsByTargetType() {
    return { data: [], total: 0 };
  },

  getAdminRequests() {
    return { data: [], total: 0 };
  },

  getAdminRequestDetail() {
    return null;
  },

  recordFailedRequest() {},
  deleteProviderCredentialCascade() { return { ok: true }; },
  archiveOffering() { return { ok: true }; },
  getAdminOfferingHealthList() { return []; },
  adminStopOffering() {},
  adminBanOffering() {},
  adminUnbanOffering() {},
  adminStartOffering() {},
  adminDeleteOffering() {},
  getOfferingStats() { return { total: { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, successRate: 0 }, today: { todayRequests: 0, todayInputTokens: 0, todayOutputTokens: 0, todaySuccessRate: 0 }, recentRequests: [], avgLatency: { total: 0, ttfb: 0, queue: 0, upstream: 0 } }; },

  getAdminSettlements() {
    return { data: [], summary: { totalConsumerCost: 0, totalSupplierReward: 0, totalPlatformMargin: 0, count: 0 } };
  },

  getAdminSettlementFailures(params) {
    return list_admin_settlement_failures(params);
  },

  retrySettlementFailure(params) {
    return retry_settlement_failure(params);
  },
  createNotification() {
    return { id: "" };
  },

  listAdminNotifications(_params?: { page?: number; limit?: number }) {
    return { data: [], total: 0 };
  },

  listUserNotifications() {
    return [];
  },

  markNotificationRead() {
    return { ok: true };
  },

  getUnreadCount() {
    return 0;
  },

  // --- Platform API Key Methods (stubs) ---
  createApiKey() { return { id: '', rawKey: '' }; },
  listApiKeys() { return []; },
  revokeApiKey() { return false; },

  // --- Node Token Methods (stubs) ---
  createNodeToken() { return { id: '', rawToken: '' }; },
  listNodeTokens() { return []; },
  revokeNodeToken() { return false; },
  authenticateNodeToken() { return null; },

  // --- Node Instance Methods (stubs) ---
  upsertNode() {},
  updateNodeStatus() {},
  updateNodeCapabilities() {},
  listUserNodes() { return []; },
  getNode() { return null; },
  listOnlineNodes() { return []; },
  setNodeOffline() {},
  incrementNodeStats() {},

  // --- Node Preferences (stubs) ---
  getNodePreferences() { return null; },
  upsertNodePreferences() {},

  // --- Node Offerings (stubs) ---
  createNodeOffering() {},
  listNodeOfferings() { return []; },
  findOfferingsForModelWithNodes() { return []; },
  setNodeOfferingsAvailability() {},
  getNodeByPublicId() { return null; },

  // --- Social: Votes (stubs) ---
  castVote() {},
  removeVote() {},
  getVoteSummary() { return { upvotes: 0, downvotes: 0, myVote: null }; },

  // --- Social: Favorites (stubs) ---
  addFavorite() {},
  removeFavorite() {},
  listFavorites() { return []; },

  // --- Social: Comments (stubs) ---
  addComment() {},
  listComments() { return []; },
  deleteComment() { return false; },

  // --- Connection Pool (stubs) ---
  joinConnectionPool() {},
  leaveConnectionPool() {},
  listConnectionPool() { return []; },
  toggleConnectionPoolPause() {},

  // --- Connection Pool model-level (stubs) ---
  joinModelPool() {},
  leaveModelPool() {},
  removeModelPool() {},
  isModelInPool() { return false; },
  listConnectionPoolGrouped() { return []; },

  // --- User Model Config (stubs) ---
  getUserModelConfig() { return null; },
  upsertUserModelConfig() {},

  // --- Market (stubs) ---
  listMarketOfferings() { return { data: [], total: 0 }; },
  getMarketOffering() { return null; },

  // --- User Profile (stubs) ---
  getPublicUserProfile() { return null; },
  listUserOfferings() { return []; },

  // --- Provider Presets (stubs) ---
  listProviderPresets() { return []; },
  getProviderPresetRaw() { return null; },
  upsertProviderPreset() {},
  deleteProviderPreset() { return false; },

  // --- Ledger (stubs) ---
  recordLedgerEntry() {},
  getLedgerHistory() { return { data: [], total: 0 }; },

  devUserApiKey: DEV_USER_API_KEY,
  devAdminApiKey: DEV_ADMIN_API_KEY
};
