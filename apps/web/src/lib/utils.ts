import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatTokens(v: number | string): string {
  const n = Number(v) || 0;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m >= 10 ? `${m.toFixed(1)}M` : `${m.toFixed(2)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return k >= 100 ? `${k.toFixed(0)}K` : `${k.toFixed(1)}K`;
  }
  return String(Math.round(n));
}

// ── Context length helpers ──────────────────────────────────────

export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  deepseek: 64000,
  minimax: 200000,
  "gpt-4o": 128000,
  claude: 200000,
  kimi: 128000,
  "kimi-for-coding": 262144,
  moonshot: 128000,
  DEFAULT: 64000,
};

export function getContextLimit(model: string): number {
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (key === "DEFAULT") continue;
    if (model.toLowerCase().includes(key.toLowerCase())) return limit;
  }
  return MODEL_CONTEXT_LIMITS.DEFAULT!;
}

export function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1000)}K`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

export function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return str.replace(/[&<>"']/g, (c) => map[c] ?? c);
}
