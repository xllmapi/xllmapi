import type { IncomingMessage, ServerResponse } from "node:http";

import { config } from "../config.js";

export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  // --- Security headers ---
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self' https: ws: wss:"
  ].join("; "));
  if (config.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // --- CORS ---
  const origin = req.headers.origin ?? "";
  if (origin) {
    res.setHeader("Vary", "Origin");
  }

  if (config.isProduction) {
    // Only allow listed origins
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    // else: no CORS header = browser blocks
  } else {
    // Development: allow all
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    if (origin) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, Idempotency-Key");
  res.setHeader("Access-Control-Max-Age", "86400");
}
