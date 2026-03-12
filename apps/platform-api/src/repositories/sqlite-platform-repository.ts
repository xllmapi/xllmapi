import type {
  CandidateOffering,
  PublicChatCompletionsRequest
} from "@xllmapi/shared-types";

import {
  create_invitation,
  create_chat_conversation,
  create_offering,
  create_provider_credential,
  find_cached_response,
  get_chat_conversation,
  find_user_by_session_token,
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
  get_supply_usage,
  list_offerings_for_model,
  get_provider_credential_by_id,
  get_wallet_balance,
  list_active_models,
  list_chat_conversations,
  list_chat_messages,
  list_admin_invitations,
  list_admin_users,
  list_invitations,
  list_offerings,
  list_pending_offerings,
  list_provider_credentials,
  record_chat_settlement,
  append_chat_message,
  delete_chat_conversation,
  update_chat_conversation_title,
  request_login_code,
  remove_offering,
  remove_provider_credential,
  revoke_invitation,
  review_offering,
  update_offering,
  update_provider_credential_status,
  update_me_profile,
  update_me_password,
  update_me_email,
  update_me_phone,
  verify_login_code,
  write_audit_log
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

  requestLoginCode(email) {
    return request_login_code(email);
  },

  verifyLoginCode(email, code) {
    return verify_login_code(email, code);
  },

  loginWithPassword(email, password) {
    return login_with_password(email, password);
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

  findOfferingForModel(logicalModel) {
    return get_offering_for_model(logicalModel);
  },

  findOfferingsForModel(logicalModel) {
    return list_offerings_for_model(logicalModel);
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

  buildCoreRequest(
    requestId: string,
    requesterUserId: string,
    body: PublicChatCompletionsRequest,
    offerings: CandidateOffering[]
  ) {
    const candidateOfferings = offerings.map((item) => ({
      ...item,
      baseUrl: item.baseUrl ?? "",
      encryptedSecret: item.encryptedSecret ?? "",
      apiKeyEnvName: item.apiKeyEnvName ?? ""
    }));

    return {
      requestId,
      traceId: requestId,
      requesterUserId,
      logicalModel: body.model,
      routingMode: "balanced" as const,
      stream: false,
      requestPayload: {
        messages: body.messages,
        temperature: body.temperature,
        maxTokens: body.max_tokens
      },
      candidateOfferings
    };
  },

  devUserApiKey: DEV_USER_API_KEY,
  devAdminApiKey: DEV_ADMIN_API_KEY
};
