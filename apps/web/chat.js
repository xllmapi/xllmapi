import {
  bindLocaleSelect,
  bindTopbarAuth,
  createApiClient,
  escapeHtml,
  getLocale,
  getSessionToken
} from "./app-common.js";

const messages = {
  zh: {
    "nav.home": "官网",
    "nav.docs": "文档",
    "nav.app": "用户平台",
    "nav.chat": "聊天",
    "nav.login": "登录",
    newConversation: "新建会话",
    inputPlaceholder: "输入消息",
    send: "发送",
    needLogin: "请先登录后查看会话并开始对话。"
  },
  en: {
    "nav.home": "Home",
    "nav.docs": "Docs",
    "nav.app": "App",
    "nav.chat": "Chat",
    "nav.login": "Login",
    newConversation: "New Conversation",
    inputPlaceholder: "Type message",
    send: "Send",
    needLogin: "Please sign in to load conversations and start chatting."
  }
};

const api = createApiClient();
const state = {
  models: [],
  conversations: [],
  activeConversationId: "",
  messages: [],
  isLoggedIn: Boolean(getSessionToken())
};

const t = (key) => messages[getLocale()]?.[key] ?? messages.en[key] ?? key;

const renderConversations = () => {
  const root = document.getElementById("conversationList");
  if (!root) return;
  if (!state.isLoggedIn) {
    root.innerHTML = `<div class="plain-row">${escapeHtml(t("needLogin"))}</div>`;
    return;
  }
  root.innerHTML = state.conversations.length
    ? state.conversations.map((item) => `<button class="sidebar-link ${item.id === state.activeConversationId ? "active" : ""}" data-conversation-id="${escapeHtml(item.id)}" type="button">${escapeHtml(item.title || item.lastMessage || item.logicalModel)}</button>`).join("")
    : `<div class="plain-row">-</div>`;
  root.querySelectorAll("[data-conversation-id]").forEach((node) => {
    node.addEventListener("click", async () => {
      state.activeConversationId = node.getAttribute("data-conversation-id") || "";
      await loadMessages();
      renderConversations();
    });
  });
};

const renderMessages = () => {
  const root = document.getElementById("chatMessages");
  if (!root) return;
  if (!state.isLoggedIn) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = state.messages.map((item) => `
    <div class="chat-message-row ${item.role === "user" ? "user" : "assistant"}">
      <span class="chat-role">${escapeHtml(item.role)}</span>
      <span class="chat-content">${escapeHtml(item.content)}</span>
    </div>
  `).join("");
  root.scrollTop = root.scrollHeight;
};

const refreshLoginState = async () => {
  const note = document.getElementById("chatNotLogin");
  state.isLoggedIn = Boolean(getSessionToken());
  if (!state.isLoggedIn) {
    note.textContent = t("needLogin");
  } else {
    note.textContent = "";
  }
};

const loadModels = async () => {
  const payload = await api.json("/v1/network/models");
  state.models = payload.data ?? [];
  const select = document.getElementById("chatModelSelect");
  if (!select) return;
  select.innerHTML = state.models.map((item) => `<option value="${escapeHtml(item.logicalModel)}">${escapeHtml(item.logicalModel)}</option>`).join("");
};

const loadConversations = async () => {
  if (!state.isLoggedIn) {
    state.conversations = [];
    state.activeConversationId = "";
    renderConversations();
    return;
  }
  const select = document.getElementById("chatModelSelect");
  const model = select?.value?.trim();
  if (!model) return;
  const payload = await api.json(`/v1/chat/conversations?model=${encodeURIComponent(model)}`);
  state.conversations = payload.data ?? [];
  if (!state.activeConversationId && state.conversations[0]?.id) {
    state.activeConversationId = state.conversations[0].id;
  }
  renderConversations();
};

const loadMessages = async () => {
  if (!state.isLoggedIn || !state.activeConversationId) {
    state.messages = [];
    renderMessages();
    return;
  }
  const payload = await api.json(`/v1/chat/conversations/${encodeURIComponent(state.activeConversationId)}/messages`);
  state.messages = payload.data ?? [];
  renderMessages();
};

const createConversation = async () => {
  if (!state.isLoggedIn) return;
  const model = document.getElementById("chatModelSelect")?.value?.trim();
  if (!model) return;
  const payload = await api.json("/v1/chat/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, title: "" })
  });
  state.activeConversationId = payload.data.id;
  await loadConversations();
  await loadMessages();
};

const streamConversation = async () => {
  if (!state.isLoggedIn || !state.activeConversationId) return;
  const input = document.getElementById("chatInput");
  const content = input?.value?.trim();
  if (!content) return;
  input.value = "";
  state.messages.push({ role: "user", content });
  renderMessages();
  state.messages.push({ role: "assistant", content: "" });
  renderMessages();

  const response = await fetch(`/v1/chat/conversations/${encodeURIComponent(state.activeConversationId)}/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${getSessionToken()}`
    },
    body: JSON.stringify({ content })
  });
  if (!response.ok || !response.body) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const eventBlock of events) {
      const dataLine = eventBlock.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const payload = JSON.parse(dataLine.slice(5).trim());
        const delta = payload?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          state.messages[state.messages.length - 1].content += delta;
          renderMessages();
        }
      } catch {
        // ignore non-json chunks
      }
    }
  }
  await loadConversations();
  await loadMessages();
};

document.getElementById("chatModelSelect")?.addEventListener("change", async () => {
  state.activeConversationId = "";
  await loadConversations();
  await loadMessages();
});
document.getElementById("newConversationButton")?.addEventListener("click", createConversation);
document.getElementById("sendChatButton")?.addEventListener("click", streamConversation);

bindLocaleSelect({ messages, onChange: refreshLoginState });
bindTopbarAuth({
  labels: getLocale() === "zh" ? { admin: "管理员", app: "平台", logout: "退出" } : undefined
});

await refreshLoginState();
await loadModels();
await loadConversations();
await loadMessages();
