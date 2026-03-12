import {
  bindTopbarAuth,
  bindLocaleSelect,
  createApiClient,
  createTranslator,
  escapeHtml,
  getLocale,
  renderEmptyState
} from "./app-common.js";

const messages = {
  zh: {
    "nav.features": "特性",
    "nav.docs": "文档",
    "nav.chat": "聊天",
    "nav.login": "登录",
    "hero.eyebrow": "LLM API 共享网络",
    "hero.subtitle": "一个连接所有模型的 LLM API 共享网络与平台。",
    "hero.note": "拥有一个 LLM API，即可连接所有模型。",
    "hero.chat": "开始聊天",
    "hero.docs": "查看 API 文档",
    "features.one.kicker": "Network",
    "features.one.title": "共享网络",
    "features.one.text": "把分散的模型供给连接到一个可调用网络中。",
    "features.two.kicker": "Compatible APIs",
    "features.two.title": "兼容接口",
    "features.two.text": "默认提供 OpenAI-compatible 与 Anthropic-compatible 接入。",
    "features.three.kicker": "Access",
    "features.three.title": "跨模型连接",
    "features.three.text": "接入一个模型 API，换取更多模型 API 的使用能力。",
    "network.title": "网络支持模型",
    "network.subtitle": "当前共享网络中可用的模型能力汇总。",
    "network.action": "去聊天页",
    "market.empty": "当前还没有可用模型。"
  },
  en: {
    "nav.features": "Features",
    "nav.docs": "Docs",
    "nav.chat": "Chat",
    "nav.login": "Login",
    "hero.eyebrow": "LLM API Shared Network",
    "hero.subtitle": "A shared LLM API network and platform that connects you to all models.",
    "hero.note": "Bring one LLM API, connect to all models.",
    "hero.chat": "Open Chat",
    "hero.docs": "API Docs",
    "features.one.kicker": "Network",
    "features.one.title": "Shared network",
    "features.one.text": "Connect distributed model supply into one callable network.",
    "features.two.kicker": "Compatible APIs",
    "features.two.title": "Compatible APIs",
    "features.two.text": "Expose OpenAI-compatible and Anthropic-compatible access by default.",
    "features.three.kicker": "Access",
    "features.three.title": "Cross-model access",
    "features.three.text": "Bring one model API and unlock access to many others.",
    "network.title": "Network models",
    "network.subtitle": "All currently supported models in the shared network.",
    "network.action": "Go to chat",
    "market.empty": "No public models yet."
  }
};

const api = createApiClient();
const t = createTranslator(messages, getLocale);

const build_track_ = (names, reverse = false) => {
  const duplicated = [...names, ...names];
  return `
    <div class="network-track ${reverse ? "reverse" : ""}">
      ${duplicated.map((name) => `<span class="network-item">${escapeHtml(name)}</span>`).join("")}
    </div>
  `;
};

const renderNetworkModels = (models) => {
  const root = document.getElementById("networkModelMarquee");
  if (!root) {
    return;
  }

  const names = Array.from(new Set((models ?? [])
    .map((item) => String(item?.logicalModel ?? "").trim())
    .filter(Boolean)
    .filter((name) => !name.endsWith("-demo") && !name.includes("test"))));

  if (!names.length) {
    root.innerHTML = renderEmptyState(t("market.empty"));
    return;
  }

  root.innerHTML = [
    build_track_(names, false),
    build_track_(names.slice(1).concat(names[0] ?? ""), true),
    build_track_(names.slice(2).concat(names.slice(0, 2)), false)
  ].join("");
};

const animateHero = () => {
  const node = document.getElementById("heroProviderWord");
  if (!node) {
    return;
  }

  const words = ["OpenAI", "Anthropic", "DeepSeek", "Qwen", "X"];
  let index = 0;
  const tick = () => {
    node.textContent = words[index];
    index += 1;
    if (index < words.length) {
      window.setTimeout(tick, index === words.length - 1 ? 480 : 380);
    }
  };
  tick();
};

const load = async () => {
  try {
    const payload = await api.json("/v1/network/models");
    renderNetworkModels(payload.data ?? []);
  } catch {
    renderNetworkModels([]);
  }
};

bindLocaleSelect({
  messages,
  onChange: () => {
    load();
  }
});

bindTopbarAuth();
animateHero();
load();
