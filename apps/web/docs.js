import { bindLocaleSelect, bindTopbarAuth } from "./app-common.js";

const messages = {
  zh: {
    "nav.home": "首页",
    "nav.docs": "文档",
    "nav.chat": "聊天",
    "nav.login": "登录",
    title: "API 文档",
    subtitle: "xllmapi 默认提供 OpenAI-compatible 与 Anthropic-compatible 接口。"
  },
  en: {
    "nav.home": "Home",
    "nav.docs": "Docs",
    "nav.chat": "Chat",
    "nav.login": "Login",
    title: "API Docs",
    subtitle: "xllmapi exposes OpenAI-compatible and Anthropic-compatible APIs by default."
  }
};

bindLocaleSelect({ messages });
bindTopbarAuth();
