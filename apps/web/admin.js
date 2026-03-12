import {
  bindLocaleSelect,
  bindTopbarAuth,
  bindViewNavigation,
  createApiClient,
  escapeHtml,
  formatNumber,
  getLocale,
  requireSession,
  renderEmptyState
} from "./app-common.js";

if (!requireSession()) {
  throw new Error("session required");
}

const messages = {
  zh: {
    "nav.home": "官网",
    "nav.admin": "管理员平台",
    "nav.login": "登录",
    "sidebar.admin": "运营",
    "sidebar.overview": "总览",
    "sidebar.users": "用户管理",
    "sidebar.invitations": "邀请管理",
    "sidebar.reviews": "模型审核",
    "sidebar.usage": "平台用量",
    "overview.title": "管理员总览",
    "overview.subtitle": "查看用户、邀请、待审核模型与平台用量概览。",
    "users.title": "用户管理",
    "invitations.title": "邀请管理",
    "invitations.send": "发送邀请",
    "reviews.title": "模型审核",
    "reviews.submit": "提交审核",
    "usage.title": "平台用量",
    "metrics.users": "用户数",
    "metrics.invites": "邀请数",
    "metrics.pending": "待审核",
    "metrics.tokens": "总 tokens",
    "common.refresh": "刷新",
    empty: "暂无数据"
  },
  en: {
    "nav.home": "Home",
    "nav.admin": "Admin",
    "nav.login": "Login",
    "sidebar.admin": "Ops",
    "sidebar.overview": "Overview",
    "sidebar.users": "Users",
    "sidebar.invitations": "Invitations",
    "sidebar.reviews": "Reviews",
    "sidebar.usage": "Usage",
    "overview.title": "Admin overview",
    "overview.subtitle": "Review users, invitations, pending models, and platform usage.",
    "users.title": "Users",
    "invitations.title": "Invitations",
    "invitations.send": "Send invitation",
    "reviews.title": "Model reviews",
    "reviews.submit": "Submit review",
    "usage.title": "Platform usage",
    "metrics.users": "Users",
    "metrics.invites": "Invitations",
    "metrics.pending": "Pending",
    "metrics.tokens": "Total tokens",
    "common.refresh": "Refresh",
    empty: "No data yet"
  }
};

const api = createApiClient();
bindViewNavigation({ storageKey: "xllmapi_admin_view", defaultView: "overview" });

const renderStack = (rootId, items, mapper) => {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = items?.length ? items.map(mapper).join("") : renderEmptyState(messages.zh.empty);
};

const load = async () => {
  const [users, invitations, pending, usage] = await Promise.all([
    api.json("/v1/admin/users"),
    api.json("/v1/admin/invitations"),
    api.json("/v1/admin/offerings/pending"),
    api.json("/v1/admin/usage")
  ]);

  document.getElementById("metricUsers").textContent = formatNumber(users.data?.length);
  document.getElementById("metricInvites").textContent = formatNumber(invitations.data?.length);
  document.getElementById("metricPending").textContent = formatNumber(pending.data?.length);
  document.getElementById("metricTokens").textContent = formatNumber(usage.data?.summary?.totalTokens);

  renderStack("usersView", users.data, (item) => `
    <article class="data-card">
      <p class="data-card-title">${escapeHtml(item.displayName)}</p>
      <p class="data-card-copy">${escapeHtml(item.email ?? "")} · ${escapeHtml(item.role)} · ${escapeHtml(item.handle ?? "")}</p>
    </article>
  `);
  renderStack("adminInvitationsView", invitations.data, (item) => `
    <article class="data-card">
      <p class="data-card-title">${escapeHtml(item.invitedEmail ?? item.invited_email)}</p>
      <p class="data-card-copy">${escapeHtml(item.status)} · ${escapeHtml(item.inviterDisplayName ?? "")}</p>
    </article>
  `);
  renderStack("reviewsView", pending.data, (item) => `
    <article class="data-card">
      <p class="data-card-title">${escapeHtml(item.logicalModel)}</p>
      <p class="data-card-copy">${escapeHtml(item.ownerUserId)} · ${escapeHtml(item.providerType)}</p>
    </article>
  `);
  renderStack("usageSummaryView", [usage.data?.summary], (item) => `
    <article class="data-card">
      <p class="data-card-title">Requests ${formatNumber(item.totalRequests)}</p>
      <p class="data-card-copy">Tokens ${formatNumber(item.totalTokens)} · Consumers ${formatNumber(item.consumerCount)}</p>
    </article>
  `);
  renderStack("usageTopModelsView", usage.data?.topModels, (item) => `
    <article class="data-card">
      <p class="data-card-title">${escapeHtml(item.logicalModel)}</p>
      <p class="data-card-copy">${formatNumber(item.requestCount)} req · ${formatNumber(item.totalTokens)} tokens</p>
    </article>
  `);
};

document.getElementById("adminInviteButton")?.addEventListener("click", async () => {
  await api.json("/v1/admin/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: document.getElementById("adminInviteEmailInput").value.trim(),
      note: document.getElementById("adminInviteNoteInput").value.trim()
    })
  });
  await load();
});

document.getElementById("submitReviewButton")?.addEventListener("click", async () => {
  const offeringId = document.getElementById("reviewOfferingIdInput").value.trim();
  const reviewStatus = document.getElementById("reviewStatusInput").value;
  await api.json(`/v1/admin/offerings/${offeringId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewStatus })
  });
  await load();
});

document.getElementById("refreshAdminButton")?.addEventListener("click", load);

bindLocaleSelect({ messages, onChange: load });
bindTopbarAuth({
  labels: getLocale() === "zh" ? { admin: "管理员", app: "平台", logout: "退出" } : undefined
});
load().catch((error) => {
  document.body.innerHTML = `<main class="page-main"><section class="page-card"><pre class="json-view">${escapeHtml(JSON.stringify(error, null, 2))}</pre></section></main>`;
});
