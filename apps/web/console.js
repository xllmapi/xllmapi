import {
  appendLog,
  bindLocaleButtons,
  bindViewNavigation,
  createApiClient,
  createTranslator,
  escapeHtml,
  formatNumber,
  getLocale,
  localizeStatus,
  renderEmptyState
} from "./app-common.js";

const messages = {
  zh: {
    "nav.home": "官网",
    "nav.console": "用户看板",
    "sidebar.group": "用户看板",
    "sidebar.overview": "概览",
    "sidebar.apiKey": "API Key",
    "sidebar.wallet": "钱包",
    "sidebar.models": "模型",
    "sidebar.credentials": "Provider Credentials",
    "sidebar.offerings": "Offerings",
    "sidebar.playground": "Playground",
    "sidebar.help": "当前用户页只展示平台真实可用能力，不再展示无后端支撑的占位页面。",
    "overview.title": "概览",
    "overview.subtitle": "查看当前钱包、模型和供给的运行状态。",
    "overview.modelsTitle": "市场模型",
    "overview.offeringsTitle": "我的供给",
    "metrics.wallet": "钱包余额",
    "metrics.models": "模型数",
    "metrics.offerings": "已启用供给",
    "metrics.credentials": "凭证数",
    "apiKey.title": "API Key",
    "apiKey.subtitle": "管理当前用户页使用的平台 API key。",
    "apiKey.label": "当前 API Key",
    "apiKey.placeholder": "xllm_demo_user_key_local",
    "apiKey.hint": "当前为本地开发 key。",
    "wallet.title": "钱包",
    "wallet.subtitle": "查看当前 token credit 余额。",
    "wallet.label": "当前余额",
    "wallet.unit": "token credit",
    "models.title": "模型",
    "models.subtitle": "查看当前可用逻辑模型与价格摘要。",
    "credentials.title": "Provider Credentials",
    "credentials.subtitle": "录入和管理你的 provider 凭证。",
    "credentials.baseUrl": "https://api.deepseek.com",
    "credentials.apiKey": "Provider API key",
    "credentials.credentialId": "credential id",
    "credentials.create": "创建凭证",
    "credentials.update": "更新状态",
    "credentials.delete": "删除凭证",
    "offerings.title": "Offerings",
    "offerings.subtitle": "创建、启停和查看你的供给。",
    "offerings.logicalModel": "xllm/user-deepseek-chat",
    "offerings.credentialId": "credential id",
    "offerings.realModel": "deepseek-chat",
    "offerings.inputPrice": "input price",
    "offerings.outputPrice": "output price",
    "offerings.offeringId": "offering id",
    "offerings.create": "创建供给",
    "offerings.update": "更新 offering",
    "offerings.delete": "删除 offering",
    "playground.title": "Playground",
    "playground.subtitle": "使用统一接口测试模型调用与流式输出。",
    "playground.run": "运行",
    "playground.model": "xllm/deepseek-chat",
    "playground.prompt": "reply with ok",
    "playground.stream": "流式",
    "playground.maxTokens": "max tokens",
    "common.save": "保存",
    "common.refresh": "刷新",
    "state.usingKey": "当前使用 Key",
    "state.notSet": "未设置",
    "state.noneModels": "暂无模型。",
    "state.noneOfferings": "暂无供给。",
    "state.noneCredentials": "暂无凭证。",
    "cards.input": "输入 / 1k",
    "cards.output": "输出 / 1k",
    "cards.status": "状态",
    "cards.review": "审核",
    "cards.secret": "密钥",
    "cards.ownerCount": "个拥有者",
    "cards.offeringCount": "个供给",
    "cards.encrypted": "已加密",
    "cards.env": "环境变量",
    "status.active": "启用",
    "status.disabled": "禁用",
    "status.enabled": "启用",
    "status.approved": "通过",
    "status.rejected": "拒绝",
    "status.pending": "待审核",
    "errors.required": "model 和 prompt 不能为空"
  },
  en: {
    "nav.home": "Home",
    "nav.console": "User Console",
    "sidebar.group": "User Console",
    "sidebar.overview": "Overview",
    "sidebar.apiKey": "API Key",
    "sidebar.wallet": "Wallet",
    "sidebar.models": "Models",
    "sidebar.credentials": "Provider Credentials",
    "sidebar.offerings": "Offerings",
    "sidebar.playground": "Playground",
    "sidebar.help": "This page only shows capabilities that are actually available on the current platform.",
    "overview.title": "Overview",
    "overview.subtitle": "Review wallet, models, and current supply state.",
    "overview.modelsTitle": "Market models",
    "overview.offeringsTitle": "My offerings",
    "metrics.wallet": "Wallet",
    "metrics.models": "Models",
    "metrics.offerings": "Enabled offerings",
    "metrics.credentials": "Credentials",
    "apiKey.title": "API Key",
    "apiKey.subtitle": "Manage the platform API key used by the user console.",
    "apiKey.label": "Current API key",
    "apiKey.placeholder": "xllm_demo_user_key_local",
    "apiKey.hint": "Using the local development key by default.",
    "wallet.title": "Wallet",
    "wallet.subtitle": "Review current token credit balance.",
    "wallet.label": "Current balance",
    "wallet.unit": "token credit",
    "models.title": "Models",
    "models.subtitle": "Browse current logical models and pricing summaries.",
    "credentials.title": "Provider Credentials",
    "credentials.subtitle": "Create and manage your provider credentials.",
    "credentials.baseUrl": "https://api.deepseek.com",
    "credentials.apiKey": "Provider API key",
    "credentials.credentialId": "credential id",
    "credentials.create": "Create credential",
    "credentials.update": "Update status",
    "credentials.delete": "Delete credential",
    "offerings.title": "Offerings",
    "offerings.subtitle": "Create, toggle, and review your offerings.",
    "offerings.logicalModel": "xllm/user-deepseek-chat",
    "offerings.credentialId": "credential id",
    "offerings.realModel": "deepseek-chat",
    "offerings.inputPrice": "input price",
    "offerings.outputPrice": "output price",
    "offerings.offeringId": "offering id",
    "offerings.create": "Create offering",
    "offerings.update": "Update offering",
    "offerings.delete": "Delete offering",
    "playground.title": "Playground",
    "playground.subtitle": "Use the unified API to test models and streaming.",
    "playground.run": "Run",
    "playground.model": "xllm/deepseek-chat",
    "playground.prompt": "reply with ok",
    "playground.stream": "stream",
    "playground.maxTokens": "max tokens",
    "common.save": "Save",
    "common.refresh": "Refresh",
    "state.usingKey": "Using key",
    "state.notSet": "not set",
    "state.noneModels": "No models available.",
    "state.noneOfferings": "No offerings yet.",
    "state.noneCredentials": "No credentials yet.",
    "cards.input": "Input / 1k",
    "cards.output": "Output / 1k",
    "cards.status": "Status",
    "cards.review": "Review",
    "cards.secret": "Secret",
    "cards.ownerCount": "owner(s)",
    "cards.offeringCount": "offering(s)",
    "cards.encrypted": "encrypted",
    "cards.env": "env",
    "status.active": "active",
    "status.disabled": "disabled",
    "status.enabled": "enabled",
    "status.approved": "approved",
    "status.rejected": "rejected",
    "status.pending": "pending",
    "errors.required": "model and prompt are required"
  }
};

const state = {
  apiKey: localStorage.getItem("xllmapi_user_api_key") || "xllm_demo_user_key_local",
  wallet: null,
  models: [],
  credentials: [],
  offerings: []
};

const translate = createTranslator(messages, getLocale);
const client = createApiClient(() => state.apiKey);

const setAuthHint = () => {
  const element = document.getElementById("authHint");
  if (!element) {
    return;
  }
  element.textContent = `${translate("state.usingKey")}: ${state.apiKey || translate("state.notSet")}`;
};

const renderModels = (targetId) => {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }

  target.innerHTML = state.models.length === 0
    ? renderEmptyState(translate("state.noneModels"))
    : state.models.map((model) => {
      const summary = model.summary || {};
      return `
        <article class="data-card">
          <span class="data-chip">${escapeHtml((summary.providers || []).join(" / ") || "provider mesh")}</span>
          <h3>${escapeHtml(model.name)}</h3>
          <p>${formatNumber(summary.ownerCount || 0)} ${escapeHtml(translate("cards.ownerCount"))} · ${formatNumber(summary.offeringCount || 0)} ${escapeHtml(translate("cards.offeringCount"))}</p>
          <div class="data-grid">
            <div>
              <span class="snapshot-meta">${escapeHtml(translate("cards.input"))}</span>
              <strong>${formatNumber(summary.minInputPricePer1k || 0)}</strong>
            </div>
            <div>
              <span class="snapshot-meta">${escapeHtml(translate("cards.output"))}</span>
              <strong>${formatNumber(summary.minOutputPricePer1k || 0)}</strong>
            </div>
          </div>
        </article>
      `;
    }).join("");
};

const renderCredentials = () => {
  const target = document.getElementById("credentialsView");
  document.getElementById("credentialsMetric").textContent = String(state.credentials.length);
  target.innerHTML = state.credentials.length === 0
    ? renderEmptyState(translate("state.noneCredentials"))
    : state.credentials.map((item) => `
        <article class="data-card">
          <span class="data-chip">${escapeHtml(item.providerType)}</span>
          <h3>${escapeHtml(item.id)}</h3>
          <p>${escapeHtml(item.baseUrl || "default provider base URL")}</p>
          <div class="data-grid">
            <div>
              <span class="snapshot-meta">${escapeHtml(translate("cards.status"))}</span>
              <strong>${escapeHtml(localizeStatus(item.status, translate))}</strong>
            </div>
            <div>
              <span class="snapshot-meta">${escapeHtml(translate("cards.secret"))}</span>
              <strong>${item.hasEncryptedSecret ? escapeHtml(translate("cards.encrypted")) : escapeHtml(translate("cards.env"))}</strong>
            </div>
          </div>
        </article>
      `).join("");
};

const renderOfferings = (targetId) => {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }

  const enabledCount = state.offerings.filter((item) => item.enabled).length;
  document.getElementById("offeringsMetric").textContent = String(enabledCount);

  target.innerHTML = state.offerings.length === 0
    ? renderEmptyState(translate("state.noneOfferings"))
    : state.offerings.map((item) => `
        <article class="data-card">
          <span class="data-chip">${escapeHtml(item.pricingMode)}</span>
          <h3>${escapeHtml(item.logicalModel)}</h3>
          <p>${escapeHtml(item.realModel)} via ${escapeHtml(item.credentialId)}</p>
          <div class="data-grid">
            <div>
              <span class="snapshot-meta">${escapeHtml(translate("cards.status"))}</span>
              <strong>${item.enabled ? escapeHtml(translate("status.enabled")) : escapeHtml(translate("status.disabled"))}</strong>
            </div>
            <div>
              <span class="snapshot-meta">${escapeHtml(translate("cards.review"))}</span>
              <strong>${escapeHtml(localizeStatus(item.reviewStatus, translate))}</strong>
            </div>
          </div>
        </article>
      `).join("");
};

const renderWallet = () => {
  const balance = state.wallet?.balance ?? null;
  document.getElementById("walletMetric").textContent = balance === null ? "--" : formatNumber(balance);
  document.getElementById("walletValue").textContent = balance === null ? "--" : formatNumber(balance);
};

const loadWallet = async () => {
  state.wallet = await client.json("/v1/wallet");
  renderWallet();
};

const loadModels = async () => {
  const payload = await client.json("/v1/models");
  state.models = payload.data || [];
  document.getElementById("modelsMetric").textContent = String(state.models.length);
  renderModels("modelsOverviewView");
  renderModels("modelsPageView");
};

const loadCredentials = async () => {
  const payload = await client.json("/v1/provider-credentials");
  state.credentials = payload.data || [];
  renderCredentials();
};

const loadOfferings = async () => {
  const payload = await client.json("/v1/offerings");
  state.offerings = payload.data || [];
  renderOfferings("offeringsOverviewView");
  renderOfferings("offeringsView");
};

const refreshAll = async () => {
  await Promise.allSettled([loadWallet(), loadModels(), loadCredentials(), loadOfferings()]);
};

const logError = (error) => {
  const chatView = document.getElementById("chatView");
  if (chatView) {
    appendLog(chatView, "error", error);
  }
};

document.getElementById("saveApiKeyButton")?.addEventListener("click", async () => {
  state.apiKey = document.getElementById("apiKeyInput").value.trim();
  localStorage.setItem("xllmapi_user_api_key", state.apiKey);
  setAuthHint();
  await refreshAll();
});

document.getElementById("refreshOverviewButton")?.addEventListener("click", () => refreshAll().catch(logError));
document.getElementById("refreshWalletButton")?.addEventListener("click", () => loadWallet().catch(logError));
document.getElementById("refreshModelsButton")?.addEventListener("click", () => loadModels().catch(logError));
document.getElementById("refreshModelsPageButton")?.addEventListener("click", () => loadModels().catch(logError));
document.getElementById("refreshCredentialsButton")?.addEventListener("click", () => loadCredentials().catch(logError));
document.getElementById("refreshOfferingsButton")?.addEventListener("click", () => loadOfferings().catch(logError));
document.getElementById("refreshOfferingsPageButton")?.addEventListener("click", () => loadOfferings().catch(logError));

document.getElementById("createCredentialButton")?.addEventListener("click", async () => {
  try {
    await client.json("/v1/provider-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerType: document.getElementById("providerTypeInput").value,
        baseUrl: document.getElementById("providerBaseUrlInput").value || undefined,
        apiKey: document.getElementById("providerApiKeyInput").value
      })
    });
    document.getElementById("providerApiKeyInput").value = "";
    await loadCredentials();
  } catch (error) {
    logError(error);
  }
});

document.getElementById("toggleCredentialButton")?.addEventListener("click", async () => {
  try {
    const id = document.getElementById("toggleCredentialIdInput").value.trim();
    await client.json(`/v1/provider-credentials/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: document.getElementById("toggleCredentialStatusInput").value
      })
    });
    await loadCredentials();
  } catch (error) {
    logError(error);
  }
});

document.getElementById("deleteCredentialButton")?.addEventListener("click", async () => {
  try {
    const id = document.getElementById("toggleCredentialIdInput").value.trim();
    await client.json(`/v1/provider-credentials/${id}`, {
      method: "DELETE"
    });
    await Promise.allSettled([loadCredentials(), loadOfferings()]);
  } catch (error) {
    logError(error);
  }
});

document.getElementById("createOfferingButton")?.addEventListener("click", async () => {
  try {
    await client.json("/v1/offerings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        logicalModel: document.getElementById("offeringLogicalModelInput").value,
        credentialId: document.getElementById("offeringCredentialIdInput").value,
        realModel: document.getElementById("offeringRealModelInput").value,
        fixedPricePer1kInput: Number(document.getElementById("offeringInputPriceInput").value || 1000),
        fixedPricePer1kOutput: Number(document.getElementById("offeringOutputPriceInput").value || 2000)
      })
    });
    await loadOfferings();
  } catch (error) {
    logError(error);
  }
});

document.getElementById("toggleOfferingButton")?.addEventListener("click", async () => {
  try {
    const id = document.getElementById("toggleOfferingIdInput").value.trim();
    await client.json(`/v1/offerings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: document.getElementById("toggleOfferingEnabledInput").value === "true"
      })
    });
    await loadOfferings();
  } catch (error) {
    logError(error);
  }
});

document.getElementById("deleteOfferingButton")?.addEventListener("click", async () => {
  try {
    const id = document.getElementById("toggleOfferingIdInput").value.trim();
    await client.json(`/v1/offerings/${id}`, {
      method: "DELETE"
    });
    await loadOfferings();
  } catch (error) {
    logError(error);
  }
});

document.getElementById("runChatButton")?.addEventListener("click", async () => {
  try {
    const model = document.getElementById("chatModelInput").value.trim();
    const prompt = document.getElementById("chatPromptInput").value.trim();
    const stream = document.getElementById("chatStreamInput").checked;
    const maxTokens = Number(document.getElementById("chatMaxTokensInput").value || 128);

    if (!model || !prompt) {
      throw new Error(translate("errors.required"));
    }

    if (!stream) {
      const response = await client.json("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }]
        })
      });
      document.getElementById("chatView").textContent = JSON.stringify(response, null, 2);
      return;
    }

    const rawResponse = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(state.apiKey ? { "x-api-key": state.apiKey } : {})
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const text = await rawResponse.text();
    document.getElementById("chatView").textContent = text;
  } catch (error) {
    logError(error);
  }
});

bindViewNavigation({
  storageKey: "xllmapi_user_view",
  defaultView: "overview"
});

bindLocaleButtons({
  messages,
  onChange: () => {
    setAuthHint();
    renderWallet();
    renderModels("modelsOverviewView");
    renderModels("modelsPageView");
    renderCredentials();
    renderOfferings("offeringsOverviewView");
    renderOfferings("offeringsView");
  }
});

document.getElementById("apiKeyInput").value = state.apiKey;
document.getElementById("chatModelInput").value = "xllm/deepseek-chat";
document.getElementById("chatPromptInput").value = "reply with ok";
setAuthHint();
refreshAll().catch(logError);
