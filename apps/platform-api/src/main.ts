import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import { DEV_ADMIN_API_KEY, DEV_USER_API_KEY } from "./constants.js";
import { cacheService } from "./cache.js";
import { config } from "./config.js";
import { json } from "./lib/http.js";
import { applySecurityHeaders } from "./middleware/security.js";
import { metricsService } from "./metrics.js";
import { platformService } from "./services/platform-service.js";
import {
  handleAuthRoutes,
  handleUserRoutes,
  handleChatRoutes,
  handleProviderRoutes,
  handleUsageRoutes,
  handleNetworkRoutes,
  handleAdminRoutes,
  handlePublicRoutes
} from "./routes/index.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const webDistRoot = resolve(process.cwd(), "apps/web/dist");
const webLegacyRoot = resolve(process.cwd(), "apps/web/_legacy");
const webRoot = existsSync(webDistRoot) ? webDistRoot : webLegacyRoot;

const read_static_file_ = (pathname: string) => {
  // Never intercept API routes or internal paths
  if (pathname.startsWith("/v1/") || pathname.startsWith("/internal/") ||
      pathname === "/healthz" || pathname === "/metrics") {
    return null;
  }

  // Try to serve the exact file first (for assets like .js, .css, .svg, etc.)
  let target = resolve(webRoot, pathname.replace(/^\//, ""));

  // Security: ensure target is within webRoot
  if (!target.startsWith(webRoot)) {
    return null;
  }

  // If the exact file exists and is a file (not directory), serve it
  if (existsSync(target) && statSync(target).isFile()) {
    // Serve the file directly
  } else {
    // SPA fallback: serve index.html for all page routes
    target = resolve(webRoot, "index.html");
    if (!existsSync(target)) {
      return null;
    }
  }

  const contentType = (() => {
    switch (extname(target)) {
      case ".html":
        return "text/html; charset=utf-8";
      case ".css":
        return "text/css; charset=utf-8";
      case ".js":
        return "text/javascript; charset=utf-8";
      case ".svg":
        return "image/svg+xml";
      case ".png":
        return "image/png";
      case ".ico":
        return "image/x-icon";
      case ".woff":
        return "font/woff";
      case ".woff2":
        return "font/woff2";
      default:
        return "application/octet-stream";
    }
  })();

  return {
    contentType,
    content: readFileSync(target)
  };
};

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  metricsService.increment("totalRequests");

  // Security middleware
  applySecurityHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // --- Health & metrics ---
    if (req.method === "GET" && url.pathname === "/healthz") {
      const cacheStatus = await cacheService.getStatus();
      const response = json(200, {
        ok: true,
        service: "platform-api",
        env: config.envMode,
        db: {
          driver: config.dbDriver,
          databaseUrlConfigured: Boolean(config.databaseUrl),
          sqliteDbPathConfigured: Boolean(config.sqliteDbPath)
        },
        cache: cacheStatus,
        requestId
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      const cacheStatus = await cacheService.getStatus();
      const response = json(200, {
        service: "platform-api",
        requestId,
        metrics: metricsService.snapshot(),
        cache: cacheStatus
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && (url.pathname === "/market" || url.pathname === "/market/")) {
      res.writeHead(302, { location: "/" });
      res.end();
      return;
    }

    // --- Static files / SPA fallback ---
    const staticFile = req.method === "GET" ? read_static_file_(url.pathname) : null;
    if (staticFile) {
      res.writeHead(200, {
        "content-type": staticFile.contentType,
        "content-length": staticFile.content.byteLength.toString()
      });
      res.end(staticFile.content);
      return;
    }

    // --- Route dispatch ---
    if (await handleAuthRoutes(req, res, url, requestId)) return;
    if (await handleUserRoutes(req, res, url, requestId)) return;
    if (await handleChatRoutes(req, res, url, requestId)) return;
    if (await handleNetworkRoutes(req, res, url, requestId)) return;
    if (await handlePublicRoutes(req, res, url, requestId)) return;
    if (await handleProviderRoutes(req, res, url, requestId)) return;
    if (await handleUsageRoutes(req, res, url, requestId)) return;
    if (await handleAdminRoutes(req, res, url, requestId)) return;

    // --- Internal debug ---
    if (req.method === "GET" && url.pathname === "/internal/debug/state") {
      const response = json(200, {
        requestId,
        state: await platformService.getDebugState(),
        devApiKey: DEV_USER_API_KEY,
        devAdminApiKey: DEV_ADMIN_API_KEY
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    // --- 404 ---
    const response = json(404, {
      error: {
        message: "Not found",
        requestId
      }
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
  } catch (error) {
    const response = json(500, {
      error: {
        message: error instanceof Error ? error.message : "unexpected error",
        requestId
      }
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
  }
});

server.listen(port, host, () => {
  console.log(`platform-api listening on http://${host}:${port}`);
});
