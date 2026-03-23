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
