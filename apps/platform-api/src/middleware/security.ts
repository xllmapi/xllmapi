import type { IncomingMessage, ServerResponse } from "node:http";

import { config } from "../config.js";

export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  // --- Security headers ---
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (config.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // --- CORS ---
  const origin = req.headers.origin ?? "";
  const allowedOrigins = config.isProduction
    ? [origin].filter(Boolean) // In production, reflect request origin (or configure allowlist)
    : ["*"];
  res.setHeader("Access-Control-Allow-Origin", allowedOrigins[0] ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, Idempotency-Key");
  res.setHeader("Access-Control-Max-Age", "86400");
}
