import {
  bindLocaleSelect,
  bindTopbarAuth,
  bindViewNavigation,
  createApiClient,
  escapeHtml,
  formatNumber,
  getLocale,
  requireSession
} from "./app-common.js";

if (!requireSession()) {
  throw new Error("session required");
}

const messages = {
  zh: {
    "nav.home": "官网",
    "nav.docs": "文档",
    "nav.chat": "聊天",
    "nav.app": "用户平台",
    "nav.login": "登录",
    "menu.overview": "总览",
    "menu.account": "账户信息",
    "menu.invite": "邀请注册",
    "menu.llmapi": "我的llm api",
    "menu.consume": "我的消费",
    "menu.chat": "聊天",
    "overview.title": "总览",
    "overview.usage": "模型用量",
    "account.title": "账户信息",
    "account.newEmail": "新邮箱",
    "account.phone": "手机号",
    "account.currentPassword": "当前密码",
    "account.newPassword": "新密码(>=8)",
    "account.updateEmail": "更新邮箱",
    "account.updatePhone": "更新手机号",
    "account.updatePassword": "修改密码",
    "invite.title": "邀请注册",
    "invite.note": "可选备注",
    "invite.send": "发送邀请",
    "llmapi.title": "我的llm api",
    "publish.guidanceDefault": "官方指导价：Input -- / 1K，Output -- / 1K",
    "publish.submit": "连接到模型网络",
    "publish.customPrice": "自定义价格（可选）",
    "consume.title": "我的消费",
    "connect.sending": "发送到服务器，验证可用性...",
    "connect.validating": "验证 API key 可用性...",
    "connect.success": "添加成功，已连接到模型网络",
    "connect.failed": "连接失败"
  },
  en: {
    "nav.home": "Home",
    "nav.docs": "Docs",
    "nav.chat": "Chat",
    "nav.app": "App",
    "nav.login": "Login",
    "menu.overview": "Overview",
    "menu.account": "Account",
    "menu.invite": "Invitations",
    "menu.llmapi": "My LLM APIs",
    "menu.consume": "My Consumption",
    "menu.chat": "Chat",
    "overview.title": "Overview",
    "overview.usage": "Model Usage",
    "account.title": "Account",
    "account.newEmail": "New email",
    "account.phone": "Phone",
    "account.currentPassword": "Current password",
    "account.newPassword": "New password (>=8)",
    "account.updateEmail": "Update email",
    "account.updatePhone": "Update phone",
    "account.updatePassword": "Update password",
    "invite.title": "Invitations",
    "invite.note": "Optional note",
    "invite.send": "Send invitation",
    "llmapi.title": "My LLM APIs",
    "publish.guidanceDefault": "Suggested price: Input -- / 1K, Output -- / 1K",
    "publish.submit": "Connect to Model Network",
    "publish.customPrice": "Custom pricing (optional)",
    "consume.title": "My consumption",
    "connect.sending": "Sending to server...",
    "connect.validating": "Validating API key availability...",
    "connect.success": "Added successfully and connected to model network",
    "connect.failed": "Connection failed"
  }
};

const api = createApiClient();
const state = {
  me: null,
  wallet: 0,
  invitationStats: null,
  invitations: [],
  providerCatalog: [],
  offerings: [],
  supplyUsage: null,
  consumptionUsage: null,
  connecting: false
};

const t = (key) => messages[getLocale()]?.[key] ?? messages.en[key] ?? key;
const empty = `<div class="plain-row">-</div>`;

const renderRows = (items, mapper) => items?.length ? items.map(mapper).join("") : empty;

const parseOptionalPositiveNumber = (value) => {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const refreshPricingGuidance = async () => {
  const presetId = document.getElementById("providerPresetInput")?.value?.trim();
  const preset = state.providerCatalog.find((item) => item.id === presetId);
  if (!preset) return;
  const result = await api.json(`/v1/pricing/guidance?logicalModel=${encodeURIComponent(preset.logicalModel)}`);
  const node = document.getElementById("pricingGuidanceText");
  if (!node) return;
  node.textContent = getLocale() === "zh"
    ? `官方指导价：Input ${formatNumber(result.data.inputPricePer1k)} / 1K，Output ${formatNumber(result.data.outputPricePer1k)} / 1K`
    : `Suggested price: Input ${formatNumber(result.data.inputPricePer1k)} / 1K, Output ${formatNumber(result.data.outputPricePer1k)} / 1K`;
};

const render = () => {
  const remain = state.invitationStats?.unlimited ? "∞" : formatNumber(state.invitationStats?.remaining ?? 0);
  document.getElementById("overviewLine").innerHTML = `
    <div class="plain-row">token: ${formatNumber(state.wallet)} · offerings: ${formatNumber(state.offerings.length)} · consume requests: ${formatNumber(state.consumptionUsage?.summary?.requestCount ?? 0)} · invites left: ${remain}</div>
  `;
  const income = Number(state.supplyUsage?.summary?.totalTokens ?? 0);
  const consume = Number(state.consumptionUsage?.summary?.totalTokens ?? 0);
  const total = Math.max(income + consume, 1);
  const incomePct = Math.round((income / total) * 100);
  const consumePct = Math.round((consume / total) * 100);
  document.getElementById("overviewUsageVisual").innerHTML = `
    <div class="plain-row">Income tokens: ${formatNumber(income)}</div>
    <div class="plain-row"><div class="usage-bar"><span style="width:${incomePct}%"></span></div></div>
    <div class="plain-row">Consume tokens: ${formatNumber(consume)}</div>
    <div class="plain-row"><div class="usage-bar consume"><span style="width:${consumePct}%"></span></div></div>
  `;
  document.getElementById("overviewUsageDetail").innerHTML = `
    <div class="plain-row">Supply detail</div>
    ${renderRows(state.supplyUsage?.items, (item) => `<div class="plain-row">${escapeHtml(item.logicalModel)} · tokens ${formatNumber(item.totalTokens)} · reward ${formatNumber(item.supplierReward)}</div>`)}
    <div class="plain-row">Consumption detail</div>
    ${renderRows(state.consumptionUsage?.items, (item) => `<div class="plain-row">${escapeHtml(item.logicalModel)} · tokens ${formatNumber(item.totalTokens)} · requests ${formatNumber(item.requestCount)}</div>`)}
  `;

  document.getElementById("accountBasicView").innerHTML = state.me ? `
    <div class="plain-row">${escapeHtml(state.me.displayName)} · ${escapeHtml(state.me.email)} · ${escapeHtml(state.me.role)}</div>
    <div class="plain-row">handle: ${escapeHtml(state.me.handle)}</div>
    <div class="plain-row">phone: ${escapeHtml(state.me.phone || "-")}</div>
  ` : empty;

  document.getElementById("invitationStatsView").innerHTML = state.invitationStats
    ? `<div class="plain-row">used ${formatNumber(state.invitationStats.used)} · remaining ${remain}</div>`
    : empty;
  document.getElementById("invitationsView").innerHTML = renderRows(state.invitations, (item) => `<div class="plain-row">${escapeHtml(item.invitedEmail ?? item.invited_email)} · ${escapeHtml(item.status)}</div>`);

  const presetInput = document.getElementById("providerPresetInput");
  if (presetInput) {
    const previous = presetInput.value;
    presetInput.innerHTML = state.providerCatalog.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${escapeHtml(item.realModel)}</option>`).join("");
    if (previous && Array.from(presetInput.options).some((option) => option.value === previous)) {
      presetInput.value = previous;
    }
  }

  document.getElementById("sharedOfferingsView").innerHTML = renderRows(state.offerings, (item) => `<div class="plain-row">${escapeHtml(item.logicalModel)} · ${escapeHtml(item.realModel)} · ${item.enabled ? "enabled" : "disabled"} · in ${formatNumber(item.fixedPricePer1kInput)} out ${formatNumber(item.fixedPricePer1kOutput)}</div>`);
  document.getElementById("usageConsumptionView").innerHTML = renderRows(state.consumptionUsage?.items, (item) => `<div class="plain-row">${escapeHtml(item.logicalModel)} · tokens ${formatNumber(item.totalTokens)} · requests ${formatNumber(item.requestCount)}</div>`);
};

const loadAll = async () => {
  const [me, wallet, invitationStats, invitations, providerCatalog, offerings, supplyUsage, consumptionUsage] = await Promise.all([
    api.json("/v1/me"),
    api.json("/v1/wallet"),
    api.json("/v1/me/invitation-stats"),
    api.json("/v1/invitations"),
    api.json("/v1/provider-catalog"),
    api.json("/v1/offerings"),
    api.json("/v1/usage/supply"),
    api.json("/v1/usage/consumption")
  ]);
  state.me = me.data;
  state.wallet = Number(wallet.balance ?? wallet.data?.availableTokenCredit ?? 0);
  state.invitationStats = invitationStats.data;
  state.invitations = invitations.data ?? [];
  state.providerCatalog = providerCatalog.data ?? [];
  state.offerings = offerings.data ?? [];
  state.supplyUsage = supplyUsage.data;
  state.consumptionUsage = consumptionUsage.data;
  render();
  await refreshPricingGuidance();
};

bindViewNavigation({ storageKey: "xllmapi_app_view_v4", defaultView: "overview" });
bindLocaleSelect({ messages, onChange: () => { render(); refreshPricingGuidance().catch(() => {}); } });
bindTopbarAuth({
  labels: getLocale() === "zh" ? { admin: "管理员", app: "平台", logout: "退出" } : undefined
});

document.getElementById("providerPresetInput")?.addEventListener("change", () => refreshPricingGuidance().catch(() => {}));
document.getElementById("createInvitationButton")?.addEventListener("click", async () => {
  await api.json("/v1/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: document.getElementById("inviteEmailInput").value.trim(),
      note: document.getElementById("inviteNoteInput").value.trim()
    })
  });
  await loadAll();
});
document.getElementById("quickPublishButton")?.addEventListener("click", async () => {
  if (state.connecting) {
    return;
  }
  const button = document.getElementById("quickPublishButton");
  try {
    state.connecting = true;
    if (button) {
      button.disabled = true;
    }
    const statusNode = document.getElementById("connectStatusText");
    const preset = state.providerCatalog.find((item) => item.id === document.getElementById("providerPresetInput").value);
    if (!preset) return;
    if (statusNode) {
      statusNode.textContent = t("connect.sending");
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (statusNode) {
      statusNode.textContent = t("connect.validating");
    }
    const createdCredential = await api.json("/v1/provider-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: preset.id,
        providerType: preset.providerType,
        baseUrl: preset.baseUrl,
        apiKey: document.getElementById("providerApiKeyInput").value.trim()
      })
    });
    await api.json("/v1/offerings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        logicalModel: preset.logicalModel,
        credentialId: createdCredential.data.id,
        realModel: preset.realModel,
        ...(parseOptionalPositiveNumber(document.getElementById("offeringInputPriceInput").value) ? { fixedPricePer1kInput: parseOptionalPositiveNumber(document.getElementById("offeringInputPriceInput").value) } : {}),
        ...(parseOptionalPositiveNumber(document.getElementById("offeringOutputPriceInput").value) ? { fixedPricePer1kOutput: parseOptionalPositiveNumber(document.getElementById("offeringOutputPriceInput").value) } : {})
      })
    });
    if (statusNode) {
      statusNode.textContent = t("connect.success");
    }
    await loadAll();
  } catch (error) {
    const statusNode = document.getElementById("connectStatusText");
    if (statusNode) {
      const message = error?.error?.message || error?.message || "";
      statusNode.textContent = `${t("connect.failed")}${message ? `: ${message}` : ""}`;
    }
  } finally {
    state.connecting = false;
    if (button) {
      button.disabled = false;
    }
  }
});

document.getElementById("updateEmailButton")?.addEventListener("click", async () => {
  await api.json("/v1/me/security/email", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newEmail: document.getElementById("securityNewEmailInput").value.trim() })
  });
  await loadAll();
});
document.getElementById("updatePhoneButton")?.addEventListener("click", async () => {
  await api.json("/v1/me/security/phone", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: document.getElementById("securityPhoneInput").value.trim() })
  });
  await loadAll();
});
document.getElementById("updatePasswordButton")?.addEventListener("click", async () => {
  await api.json("/v1/me/security/password", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      currentPassword: document.getElementById("securityCurrentPasswordInput").value,
      newPassword: document.getElementById("securityNewPasswordInput").value
    })
  });
});

loadAll().catch((error) => {
  document.body.innerHTML = `<main class="page-main"><section class="page-card"><pre class="json-view">${escapeHtml(JSON.stringify(error, null, 2))}</pre></section></main>`;
});
