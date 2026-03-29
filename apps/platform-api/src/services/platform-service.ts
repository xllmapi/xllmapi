import crypto from "crypto";

import type {
  CandidateOffering
} from "@xllmapi/shared-types";

import { config } from "../config.js";
import { renderTransactionalEmail, emailSender, type TransactionalEmailTemplateKey } from "../email.js";
import { metricsService } from "../metrics.js";
import { platformRepository } from "../repositories/index.js";

type ProviderPreset = {
  id: string;
  label: string;
  providerType: CandidateOffering["providerType"];
  baseUrl: string;
  anthropicBaseUrl?: string;
  logicalModel: string;
  realModel: string;
  customHeaders?: unknown | null;
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
    anthropicBaseUrl: "https://api.minimaxi.com/anthropic",
    logicalModel: "MiniMax-M2.7",
    realModel: "MiniMax-M2.7"
  },
  {
    id: "minimax",
    label: "MiniMax",
    providerType: "openai_compatible",
    baseUrl: "https://api.minimaxi.com/v1",
    anthropicBaseUrl: "https://api.minimaxi.com/anthropic",
    logicalModel: "MiniMax-M2.5",
    realModel: "MiniMax-M2.5"
  },
  {
    id: "minimax",
    label: "MiniMax",
    providerType: "openai_compatible",
    baseUrl: "https://api.minimaxi.com/v1",
    anthropicBaseUrl: "https://api.minimaxi.com/anthropic",
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

const resolveLocale_ = (email?: string | null): "zh" | "en" => {
  return email?.endsWith(".cn") ? "zh" : "en";
};

const send_transactional_email_ = async (params: {
  templateKey: TransactionalEmailTemplateKey;
  toEmail: string;
  challengeId?: string | null;
  locale?: "zh" | "en";
  metadata?: Record<string, unknown>;
  variables: Record<string, unknown>;
}) => {
  const rendered = renderTransactionalEmail(params.templateKey, {
    locale: params.locale ?? resolveLocale_(params.toEmail),
    ...params.variables
  });
  const deliveryId = `mail_${crypto.randomUUID()}`;

  try {
    const sendResult = await emailSender.send({
      templateKey: params.templateKey,
      toEmail: params.toEmail,
      locale: params.locale ?? resolveLocale_(params.toEmail),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      metadata: {
        ...params.metadata,
        ...params.variables
      }
    });
    await platformRepository.recordEmailDeliveryAttempt({
      id: deliveryId,
      provider: sendResult.provider,
      templateKey: params.templateKey,
      toEmail: params.toEmail,
      subject: rendered.subject,
      challengeId: params.challengeId ?? null,
      status: "sent",
      providerMessageId: sendResult.providerMessageId ?? null,
      payload: {
        preview: sendResult.preview ?? null,
        metadata: params.metadata ?? null,
        variables: params.variables
      }
    });
    metricsService.increment("emailSends");
    return { ok: true as const };
  } catch (error) {
    await platformRepository.recordEmailDeliveryAttempt({
      id: deliveryId,
      provider: "email",
      templateKey: params.templateKey,
      toEmail: params.toEmail,
      subject: rendered.subject,
      challengeId: params.challengeId ?? null,
      status: "failed",
      errorCode: "send_failed",
      errorMessage: String(error),
      payload: {
        metadata: params.metadata ?? null,
        variables: params.variables
      }
    });
    metricsService.increment("emailSendFailures");
    return { ok: false as const, message: String(error) };
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

  async listProviderCatalog(): Promise<ProviderPreset[]> {
    try {
      const dbPresets = await platformRepository.listProviderPresets();
      if (dbPresets.length > 0) {
        const flat: ProviderPreset[] = [];
        for (const p of dbPresets) {
          if (!p.enabled) continue;
          const models = (Array.isArray(p.models) ? p.models : []) as Array<{ logicalModel: string; realModel: string }>;
          for (const m of models) {
            flat.push({
              id: p.id,
              label: p.label,
              providerType: p.providerType as CandidateOffering["providerType"],
              baseUrl: p.baseUrl,
              anthropicBaseUrl: p.anthropicBaseUrl ?? undefined,
              logicalModel: m.logicalModel,
              realModel: m.realModel,
              customHeaders: p.customHeaders ?? null,
            });
          }
        }
        if (flat.length > 0) return flat;
      }
    } catch {
      // fallback to hardcoded
    }
    return PROVIDER_PRESETS;
  },

  async getProviderPresetById(id: string): Promise<ProviderPreset | null> {
    const catalog = await this.listProviderCatalog();
    return catalog.find((item) => item.id === id) ?? null;
  },

  async listProviderPresets() {
    return platformRepository.listProviderPresets();
  },

  async upsertProviderPreset(params: {
    id: string; label: string; providerType: string; baseUrl: string;
    anthropicBaseUrl?: string | null; models: unknown[]; enabled?: boolean;
    sortOrder?: number; updatedBy?: string; customHeaders?: unknown | null;
  }) {
    return platformRepository.upsertProviderPreset(params);
  },

  async deleteProviderPreset(id: string) {
    return platformRepository.deleteProviderPreset(id);
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

    // Read admin-configured default pricing
    const adminInputPrice = Number(await platformRepository.getConfigValue("default_input_price_per_1k")) || 0;
    const adminOutputPrice = Number(await platformRepository.getConfigValue("default_output_price_per_1k")) || 0;
    const fallbackInput = adminInputPrice > 0 ? adminInputPrice : 1000;
    const fallbackOutput = adminOutputPrice > 0 ? adminOutputPrice : 2000;

    const defaults = { inputPricePer1k: fallbackInput, outputPricePer1k: fallbackOutput, source: "default_profile" as const };

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

  revokeSession(sessionId: string) {
    return platformRepository.revokeSession(sessionId);
  },

  checkHealth() {
    return platformRepository.checkHealth();
  },

  async requestLoginCode(email: string) {
    const result = await platformRepository.requestLoginCode(email);
    if (!result.eligible || !result.challengeId || !result.code) {
      return result;
    }

    await send_transactional_email_({
      templateKey: "login_code",
      toEmail: result.email,
      challengeId: result.challengeId,
      variables: {
        code: result.code,
        expiresInMinutes: Math.ceil(config.authCodeTtlSeconds / 60)
      }
    });

    return result;
  },

  verifyLoginCode(email: string, code: string) {
    return platformRepository.verifyLoginCode(email, code);
  },

  loginWithPassword(email: string, password: string) {
    return platformRepository.loginWithPassword(email, password);
  },

  async requestPasswordReset(email: string) {
    const result = await platformRepository.requestPasswordReset(email);
    if (!result.accepted || !result.token || !result.challengeId) {
      return { accepted: false as const, email: result.email };
    }

    await send_transactional_email_({
      templateKey: "password_reset",
      toEmail: result.email,
      challengeId: result.challengeId,
      variables: {
        actionUrl: `${config.appBaseUrl || "http://127.0.0.1:3000"}/reset-password?token=${encodeURIComponent(result.token)}`,
        expiresInMinutes: Math.ceil(config.passwordResetTtlSeconds / 60)
      }
    });

    if (result.userId) {
      await platformRepository.recordSecurityEvent({
        id: `se_${crypto.randomUUID()}`,
        userId: result.userId,
        type: "password_reset_requested",
        severity: "warning",
        payload: { email: result.email }
      });
      metricsService.increment("securityEvents");
    }

    return { accepted: true as const, email: result.email };
  },

  async resetPassword(params: { token: string; newPassword: string }) {
    const result = await platformRepository.resetPassword(params);
    if (!result.ok || !result.data) {
      return result;
    }

    const me = await platformRepository.getMe(result.data.userId);
    if (me && config.securityNotifyEmailEnabled) {
      await send_transactional_email_({
        templateKey: "password_changed_notice",
        toEmail: me.email,
        variables: {}
      });
    }

    await platformRepository.recordSecurityEvent({
      id: `se_${crypto.randomUUID()}`,
      userId: result.data.userId,
      type: "password_reset_completed",
      severity: "warning",
      payload: { sessionsRevoked: result.data.sessionsRevoked }
    });
    metricsService.increment("securityEvents");

    return result;
  },

  updateMeProfile(params: {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
  }) {
    return platformRepository.updateMeProfile(params);
  },

  async updateMePassword(params: {
    userId: string;
    currentSessionId?: string | null;
    currentPassword: string;
    newPassword: string;
  }) {
    const result = await platformRepository.updateMePassword(params);
    if (!result.ok) {
      return result;
    }

    const me = await platformRepository.getMe(params.userId);
    if (me && config.securityNotifyEmailEnabled) {
      await send_transactional_email_({
        templateKey: "password_changed_notice",
        toEmail: me.email,
        variables: {}
      });
    }

    await platformRepository.recordSecurityEvent({
      id: `se_${crypto.randomUUID()}`,
      userId: params.userId,
      type: "password_changed",
      severity: "warning",
      payload: {
        sessionsRevoked: result.data?.sessionsRevoked ?? 0
      }
    });
    metricsService.increment("securityEvents");

    return result;
  },

  async updateMeEmail(params: {
    userId: string;
    newEmail: string;
    currentPassword?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    const result = await platformRepository.requestEmailChange(params);
    if (!result.ok || !result.data) {
      return result;
    }

    await Promise.all([
      send_transactional_email_({
        templateKey: "email_change_confirm",
        toEmail: result.data.newEmail,
        challengeId: result.data.challengeId,
        variables: {
          newEmail: result.data.newEmail,
          actionUrl: `${config.appBaseUrl || "http://127.0.0.1:3000"}/auth/confirm-email-change?token=${encodeURIComponent(result.data.token ?? "")}`,
          expiresInMinutes: Math.ceil(config.emailChangeTtlSeconds / 60)
        }
      }),
      send_transactional_email_({
        templateKey: "email_change_requested_notice",
        toEmail: result.data.oldEmail,
        variables: {
          oldEmail: result.data.oldEmail,
          newEmail: result.data.newEmail
        }
      }),
      Promise.resolve(platformRepository.recordSecurityEvent({
        id: `se_${crypto.randomUUID()}`,
        userId: params.userId,
        type: "email_change_requested",
        severity: "warning",
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        payload: {
          oldEmail: result.data.oldEmail,
          newEmail: result.data.newEmail
        }
      })).then(() => {
        metricsService.increment("securityEvents");
      })
    ]);

    return result;
  },

  async confirmMeEmailChange(params: {
    token: string;
    sessionId?: string | null;
  }) {
    const result = await platformRepository.confirmEmailChange(params);
    if (!result.ok || !result.data) {
      return result;
    }

    const tasks: Promise<unknown>[] = [
      send_transactional_email_({
        templateKey: "email_changed_notice",
        toEmail: result.data.oldEmail,
        variables: {
          oldEmail: result.data.oldEmail,
          newEmail: result.data.newEmail
        }
      }),
      send_transactional_email_({
        templateKey: "email_changed_notice",
        toEmail: result.data.newEmail,
        variables: {
          oldEmail: result.data.oldEmail,
          newEmail: result.data.newEmail
        }
      })
    ];
    if (result.data.profile?.id) {
      tasks.push(
        Promise.resolve(platformRepository.recordSecurityEvent({
          id: `se_${crypto.randomUUID()}`,
          userId: result.data.profile.id,
          type: "email_changed",
          severity: "warning",
          payload: {
            oldEmail: result.data.oldEmail,
            newEmail: result.data.newEmail
          }
        })).then(() => {
          metricsService.increment("securityEvents");
        })
      );
    }
    await Promise.all(tasks);

    return {
      ok: true as const,
      data: result.data.profile
    };
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

  async createInvitation(params: {
    inviterUserId: string;
    invitedEmail: string;
    note?: string;
  }) {
    const result = await platformRepository.createInvitation(params);
    if (!result.ok) {
      return result;
    }
    const inviter = await platformRepository.getMe(params.inviterUserId);
    await send_transactional_email_({
      templateKey: "invite",
      toEmail: params.invitedEmail,
      variables: {
        inviterName: inviter?.displayName || inviter?.email || "xllmapi",
        invitationNote: params.note ?? null,
        actionUrl: `${config.appBaseUrl || "http://127.0.0.1:3000"}/auth?email=${encodeURIComponent(params.invitedEmail)}`
      },
      metadata: {
        invitationId: result.data?.id ?? null
      }
    });
    return result;
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

  async getAdminAllInvitations(limit?: number) {
    return platformRepository.getAdminAllInvitations(limit);
  },

  listAdminUsers() {
    return platformRepository.listAdminUsers();
  },

  async createAdminInvitation(params: {
    inviterUserId: string;
    invitedEmail: string;
    note?: string;
  }) {
    const result = await platformRepository.createAdminInvitation(params);
    if (!result.ok) {
      return result;
    }
    const inviter = await platformRepository.getMe(params.inviterUserId);
    await send_transactional_email_({
      templateKey: "invite",
      toEmail: params.invitedEmail,
      variables: {
        inviterName: inviter?.displayName || inviter?.email || "xllmapi",
        invitationNote: params.note ?? null,
        actionUrl: `${config.appBaseUrl || "http://127.0.0.1:3000"}/auth?email=${encodeURIComponent(params.invitedEmail)}`
      },
      metadata: {
        invitationId: result.data?.id ?? null
      }
    });
    return result;
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

  recordSecurityEvent(params: {
    userId: string;
    type: string;
    severity: "info" | "warning" | "critical";
    ipAddress?: string | null;
    userAgent?: string | null;
    payload?: unknown;
  }) {
    return Promise.resolve(platformRepository.recordSecurityEvent({
      id: `se_${crypto.randomUUID()}`,
      ...params,
    }));
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
    anthropicBaseUrl?: string;
    apiKey: string;
    customHeaders?: unknown | null;
    providerLabel?: string | null;
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

  getConfigValue(key: string) {
    return platformRepository.getConfigValue(key);
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
    maxConcurrency?: number;
    dailyTokenLimit?: number;
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
    contextLength?: number;
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
  recordSettlementFailure: platformRepository.recordSettlementFailure,

  getAdminSettlementFailures(params: { page: number; limit: number; status?: "open" | "resolved" | "all" }) {
    return platformRepository.getAdminSettlementFailures(params);
  },

  retrySettlementFailure(params: { failureId: string; actorUserId: string }) {
    return platformRepository.retrySettlementFailure(params);
  },

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

  listAdminEmailDeliveries(limit: number) {
    return platformRepository.listAdminEmailDeliveries(limit);
  },

  listAdminSecurityEvents(limit: number) {
    return platformRepository.listAdminSecurityEvents(limit);
  },

  getAdminRequests(params: { model?: string; provider?: string; user?: string; days?: number; page: number; limit: number }) {
    return platformRepository.getAdminRequests(params);
  },

  getAdminSettlements(params: { days?: number; page: number; limit: number }) {
    return platformRepository.getAdminSettlements(params);
  },

  createNotification(params: { id: string; title: string; body: string; type: string; targetUserId?: string | null; createdBy: string }) {
    return platformRepository.createNotification(params);
  },

  findUserByHandle(handle: string) {
    return platformRepository.findUserByHandle(handle);
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
