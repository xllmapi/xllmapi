import {
  bindLocaleSelect,
  createApiClient,
  escapeHtml,
  formatNumber,
  getHandleFromPath,
  getSessionToken,
  renderEmptyState
} from "./app-common.js";

const messages = {
  zh: {
    "nav.home": "首页",
    "metrics.models": "活跃模型",
    "metrics.users": "服务用户",
    "metrics.tokens": "总 tokens",
    "metrics.runtime": "稳定运行",
    "offerings.title": "公开模型"
  },
  en: {
    "nav.home": "Home",
    "metrics.models": "Active models",
    "metrics.users": "Served users",
    "metrics.tokens": "Total tokens",
    "metrics.runtime": "Runtime",
    "offerings.title": "Public models"
  }
};

const api = createApiClient();

const formatRuntime = (seconds) => {
  const value = Number(seconds ?? 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  return `${days}d ${hours}h`;
};

const load = async () => {
  const sessionToken = getSessionToken();
  if (!sessionToken) {
    window.location.href = "/auth";
    return;
  }
  const session = await api.json("/v1/auth/session");
  if (session.data?.role !== "admin") {
    document.body.innerHTML = `<main class="page-main"><section class="page-card"><p>403 Forbidden</p></section></main>`;
    return;
  }

  const handle = getHandleFromPath();
  const [profile, offerings] = await Promise.all([
    api.json(`/v1/public/users/${handle}`),
    api.json(`/v1/public/users/${handle}/offerings`)
  ]);

  document.getElementById("supplierTitle").textContent = profile.data.displayName;
  document.getElementById("supplierSubtitle").textContent = `@${profile.data.handle}`;
  document.getElementById("supplierModels").textContent = formatNumber(profile.data.activeOfferingCount);
  document.getElementById("supplierUsers").textContent = formatNumber(profile.data.servedUserCount);
  document.getElementById("supplierTokens").textContent = formatNumber(profile.data.totalSupplyTokens);
  document.getElementById("supplierRuntime").textContent = formatRuntime(profile.data.totalStableSeconds);
  const root = document.getElementById("supplierOfferings");
  root.innerHTML = (offerings.data?.length ? offerings.data.map((item) => `
    <article class="data-card">
      <p class="data-card-title">${escapeHtml(item.logicalModel)}</p>
      <p class="data-card-copy">${escapeHtml(item.realModel)} · ${escapeHtml(item.providerType)}</p>
      <p class="data-card-copy">Input ${formatNumber(item.inputPricePer1k)} / 1K · Output ${formatNumber(item.outputPricePer1k)} / 1K</p>
      <p class="data-card-copy">${formatNumber(item.servedUserCount)} users · ${formatRuntime(item.stableSeconds)}</p>
    </article>
  `).join("") : renderEmptyState("No public offerings"));
};

bindLocaleSelect({ messages, onChange: load });
load().catch((error) => {
  document.body.innerHTML = `<main class="page-main"><section class="page-card"><pre class="json-view">${escapeHtml(JSON.stringify(error, null, 2))}</pre></section></main>`;
});
