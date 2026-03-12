export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const formatNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : "--";
};

export const getLocale = () => localStorage.getItem("xllmapi_locale") || "zh";

export const setLocale = (locale) => {
  localStorage.setItem("xllmapi_locale", locale);
};

export const getSessionToken = () => localStorage.getItem("xllmapi_session_token") || "";

export const setSessionToken = (token) => {
  if (!token) {
    localStorage.removeItem("xllmapi_session_token");
    return;
  }
  localStorage.setItem("xllmapi_session_token", token);
};

export const clearSession = () => {
  localStorage.removeItem("xllmapi_session_token");
};

export const getPlatformApiKey = () => localStorage.getItem("xllmapi_platform_api_key") || "";

export const setPlatformApiKey = (value) => {
  if (!value) {
    localStorage.removeItem("xllmapi_platform_api_key");
    return;
  }
  localStorage.setItem("xllmapi_platform_api_key", value);
};

export const createTranslator = (messages, getCurrentLocale) => (key) =>
  messages[getCurrentLocale()]?.[key] ?? messages.en?.[key] ?? key;

export const applyTranslations = ({ messages, getCurrentLocale, root = document }) => {
  const translate = createTranslator(messages, getCurrentLocale);
  document.documentElement.lang = getCurrentLocale() === "zh" ? "zh-CN" : "en";

  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = translate(element.getAttribute("data-i18n"));
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", translate(element.getAttribute("data-i18n-placeholder")));
  });

  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.setAttribute("title", translate(element.getAttribute("data-i18n-title")));
  });

  root.querySelectorAll("[data-i18n-html]").forEach((element) => {
    element.innerHTML = translate(element.getAttribute("data-i18n-html"));
  });
};

export const bindLocaleButtons = ({ messages, onChange }) => {
  const refreshButtons = () => {
    const locale = getLocale();
    document.getElementById("langZhButton")?.classList.toggle("active", locale === "zh");
    document.getElementById("langEnButton")?.classList.toggle("active", locale === "en");
  };

  const rerender = () => {
    applyTranslations({ messages, getCurrentLocale: getLocale });
    refreshButtons();
    onChange?.();
  };

  document.getElementById("langZhButton")?.addEventListener("click", () => {
    setLocale("zh");
    rerender();
  });

  document.getElementById("langEnButton")?.addEventListener("click", () => {
    setLocale("en");
    rerender();
  });

  rerender();
};

export const bindLocaleSelect = ({ messages, selectId = "localeSelect", onChange }) => {
  const select = document.getElementById(selectId);
  if (!select) {
    bindLocaleButtons({ messages, onChange });
    return;
  }

  const rerender = () => {
    applyTranslations({ messages, getCurrentLocale: getLocale });
    select.value = getLocale();
    onChange?.();
  };

  select.addEventListener("change", () => {
    const value = select.value === "en" ? "en" : "zh";
    setLocale(value);
    rerender();
  });

  rerender();
};

export const bindViewNavigation = ({ storageKey, defaultView }) => {
  const getView = () => localStorage.getItem(storageKey) || defaultView;
  const setView = (view) => {
    localStorage.setItem(storageKey, view);
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-view") === view);
    });
    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.getAttribute("data-view-panel") === view);
    });
  };

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.getAttribute("data-view");
      if (view) {
        setView(view);
      }
    });
  });

  setView(getView());
  return { getView, setView };
};

export const createApiClient = () => ({
  async json(path, init = {}) {
    const sessionToken = getSessionToken();
    const apiKey = getPlatformApiKey();
    const headers = {
      ...(init.headers || {}),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...(!sessionToken && apiKey ? { "x-api-key": apiKey } : {})
    };
    const response = await fetch(path, { ...init, headers });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw body ?? { error: { message: `request failed with ${response.status}` } };
    }
    return body;
  },

  async raw(path, init = {}) {
    const sessionToken = getSessionToken();
    const apiKey = getPlatformApiKey();
    const headers = {
      ...(init.headers || {}),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...(!sessionToken && apiKey ? { "x-api-key": apiKey } : {})
    };
    return fetch(path, { ...init, headers });
  }
});

export const localizeStatus = (value, translate) => {
  const key = `status.${String(value ?? "").toLowerCase()}`;
  const translated = translate(key);
  return translated === key ? String(value ?? "") : translated;
};

export const appendLog = (element, title, data) => {
  if (!element) {
    return;
  }
  const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  element.textContent = `[${new Date().toISOString()}] ${title}\n${payload}\n\n${element.textContent}`;
};

export const renderEmptyState = (message) =>
  `<article class="empty-card">${escapeHtml(message)}</article>`;

export const requireSession = () => {
  if (!getSessionToken()) {
    window.location.href = "/auth";
    return false;
  }
  return true;
};

export const getHandleFromPath = () => {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments.length >= 2 ? decodeURIComponent(segments[1]) : "";
};

export const bindTopbarAuth = async ({
  loginSelector = ".nav-login",
  appHref = "/app",
  labels = {
    admin: "Admin",
    app: "App",
    logout: "Logout"
  }
} = {}) => {
  const loginNode = document.querySelector(loginSelector);
  if (!loginNode) {
    return;
  }

  const token = getSessionToken();
  if (!token) {
    return;
  }

  try {
    const response = await fetch("/v1/auth/session", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      clearSession();
      return;
    }
    const payload = await response.json();
    const me = payload?.data;
    if (!me) {
      clearSession();
      return;
    }

    const avatarUrl = me.avatarUrl || "/assets/avatar-default.svg";
    const menuHtml = `
      <div class="topbar-user" id="topbarUserRoot">
        <button class="topbar-user-trigger" type="button" id="topbarUserTrigger">
          <img class="topbar-avatar" src="${escapeHtml(avatarUrl)}" alt="avatar" />
        </button>
        <div class="topbar-user-menu" id="topbarUserMenu">
          <a href="${me.role === "admin" ? "/admin" : appHref}">${me.role === "admin" ? labels.admin : labels.app}</a>
          <button type="button" id="topbarLogoutButton">${labels.logout}</button>
        </div>
      </div>
    `;

    loginNode.outerHTML = menuHtml;
    const root = document.getElementById("topbarUserRoot");
    const trigger = document.getElementById("topbarUserTrigger");
    const menu = document.getElementById("topbarUserMenu");
    const logout = document.getElementById("topbarLogoutButton");

    trigger?.addEventListener("click", () => {
      root?.classList.toggle("open");
    });
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (root && !root.contains(target)) {
        root.classList.remove("open");
      }
    });
    logout?.addEventListener("click", () => {
      clearSession();
      window.location.href = "/auth";
    });
  } catch {
    clearSession();
  }
};
