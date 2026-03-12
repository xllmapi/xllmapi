import {
  appendLog,
  bindTopbarAuth,
  bindLocaleSelect,
  createApiClient,
  getPlatformApiKey,
  setPlatformApiKey,
  setSessionToken
} from "./app-common.js";

const messages = {
  zh: {
    "nav.home": "首页",
    "nav.docs": "文档",
    "nav.chat": "聊天",
    "nav.login": "登录",
    kicker: "邀请制",
    title: "登录 xllmapi",
    copy: "优先使用邮箱+密码登录。首次受邀注册可用验证码登录后再在账户里设置密码。",
    email: "邮箱地址",
    password: "登录密码",
    passwordLogin: "密码登录",
    code: "验证码",
    requestCode: "发送验证码",
    login: "登录"
  },
  en: {
    "nav.home": "Home",
    "nav.docs": "Docs",
    "nav.chat": "Chat",
    "nav.login": "Login",
    kicker: "Invite only",
    title: "Sign in to xllmapi",
    copy: "Use email + password first. Invited first-time users can sign in with verification code, then set password in account security.",
    email: "Email",
    password: "Password",
    passwordLogin: "Password login",
    code: "Code",
    requestCode: "Send code",
    login: "Sign in"
  }
};

const api = createApiClient();
const logElement = document.getElementById("authLog");

document.getElementById("requestCodeButton")?.addEventListener("click", async () => {
  const email = document.getElementById("emailInput")?.value?.trim();
  try {
    const result = await api.json("/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    if (result?.devCode) {
      const codeInput = document.getElementById("codeInput");
      if (codeInput) {
        codeInput.value = result.devCode;
      }
    }
    appendLog(logElement, "request-code", result);
  } catch (error) {
    appendLog(logElement, "request-code:error", error);
  }
});

document.getElementById("verifyCodeButton")?.addEventListener("click", async () => {
  const email = document.getElementById("emailInput")?.value?.trim();
  const code = document.getElementById("codeInput")?.value?.trim();
  try {
    const result = await api.json("/v1/auth/verify-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code })
    });
    setSessionToken(result.token);
    if (result.initialApiKey) {
      setPlatformApiKey(result.initialApiKey);
    } else if (!getPlatformApiKey()) {
      setPlatformApiKey("xllm_demo_user_key_local");
    }
    appendLog(logElement, "verify-code", result);
    window.location.href = result.redirectTo;
  } catch (error) {
    appendLog(logElement, "verify-code:error", error);
  }
});

document.getElementById("passwordLoginButton")?.addEventListener("click", async () => {
  const email = document.getElementById("emailInput")?.value?.trim();
  const password = document.getElementById("passwordInput")?.value?.trim();
  try {
    const result = await api.json("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    setSessionToken(result.token);
    if (!getPlatformApiKey()) {
      setPlatformApiKey("xllm_demo_user_key_local");
    }
    appendLog(logElement, "password-login", result);
    window.location.href = result.redirectTo;
  } catch (error) {
    appendLog(logElement, "password-login:error", error);
  }
});

bindLocaleSelect({ messages });
bindTopbarAuth();
