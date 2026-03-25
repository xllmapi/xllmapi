const SESSION_TOKEN_KEY = "xllmapi_session_token";
const API_KEY_KEY = "xllmapi_platform_api_key";

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setSessionToken(token: string | null) {
  if (token) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_KEY);
}

export function setApiKey(key: string | null) {
  if (key) {
    localStorage.setItem(API_KEY_KEY, key);
  } else {
    localStorage.removeItem(API_KEY_KEY);
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getSessionToken();
  const apiKey = getApiKey();
  if (token) return { Authorization: `Bearer ${token}` };
  if (apiKey) return { "x-api-key": apiKey };
  return {};
}

export interface ApiError {
  error: { message: string; code?: string };
}

export async function apiJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
    ...(init.body ? { "content-type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  const response = await fetch(path, { ...init, headers, credentials: init.credentials ?? "include" });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw (body as ApiError) ?? {
      error: { message: `Request failed with ${response.status}` },
    };
  }

  return body as T;
}

export async function apiRaw(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };

  return fetch(path, { ...init, headers, credentials: init.credentials ?? "include" });
}
