import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import { DEV_ADMIN_API_KEY, DEV_USER_API_KEY } from "./constants.js";
import { cacheService } from "./cache.js";
import { config } from "./config.js";
import { json } from "./lib/http.js";
import { AppError } from "./lib/errors.js";
import { applySecurityHeaders } from "./middleware/security.js";
import { metricsService } from "./metrics.js";
import { platformService } from "./services/platform-service.js";
import {
  handleAuthRoutes,
  handleUserRoutes,
  handleApiProxyRoutes,
  handleChatRoutes,
  handleProviderRoutes,
  handleUsageRoutes,
  handleNetworkRoutes,
  handleNotificationRoutes,
  handleNodeRoutes,
  handleMarketRoutes,
  handleAdminRoutes,
  handlePublicRoutes
} from "./routes/index.js";
import { nodeConnectionManager } from "./core/node-connection-manager.js";

process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled rejection:", reason);
  // Don't exit — log and continue
});

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const webDistRoot = resolve(process.cwd(), "apps/web/dist");
const webReleasesRoot = resolve(process.cwd(), "apps/web/releases");
const webLegacyRoot = resolve(process.cwd(), "apps/web/_legacy");
const webRoot = existsSync(webDistRoot) ? webDistRoot : webLegacyRoot;
const staticAssetPattern = /\.(?:css|js|mjs|svg|png|ico|woff2?|map)$/i;
let isShuttingDown = false;

type StaticFileResult =
  | {
      statusCode: 404;
    }
  | {
      statusCode: 200;
      contentType: string;
      content: Buffer;
    };

const read_buffer_file_ = (target: string) => ({
  contentType: (() => {
    switch (extname(target)) {
      case ".html":
        return "text/html; charset=utf-8";
      case ".css":
        return "text/css; charset=utf-8";
      case ".js":
      case ".mjs":
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
      case ".map":
        return "application/json; charset=utf-8";
      default:
        return "application/octet-stream";
    }
  })(),
  content: readFileSync(target)
});

const is_asset_request_ = (pathname: string) =>
  pathname.startsWith("/assets/") ||
  pathname.startsWith("/_releases/") ||
  staticAssetPattern.test(pathname);

const read_release_asset_file_ = (pathname: string): StaticFileResult | null => {
  if (!pathname.startsWith("/_releases/")) {
    return null;
  }

  const releasePath = pathname.slice("/_releases/".length);
  const slashIndex = releasePath.indexOf("/");
  if (slashIndex <= 0) {
    return {
      statusCode: 404
    };
  }

  const releaseId = releasePath.slice(0, slashIndex);
  const relativePath = releasePath.slice(slashIndex + 1);
  const releaseRoot = resolve(webReleasesRoot, releaseId);
  const target = resolve(releaseRoot, relativePath);
  if (!target.startsWith(releaseRoot)) {
    return {
      statusCode: 404
    };
  }

  if (existsSync(target) && statSync(target).isFile()) {
    return {
      statusCode: 200,
      ...read_buffer_file_(target)
    };
  }

  if (releaseId === config.releaseId) {
    const currentTarget = resolve(webDistRoot, relativePath);
    if (currentTarget.startsWith(webDistRoot) && existsSync(currentTarget) && statSync(currentTarget).isFile()) {
      return {
        statusCode: 200,
        ...read_buffer_file_(currentTarget)
      };
    }
  }

  return {
    statusCode: 404
  };
};

const read_static_file_ = (pathname: string): StaticFileResult | null => {
  // Never intercept API routes or internal paths
  if (pathname.startsWith("/v1/") || pathname.startsWith("/internal/") ||
      pathname.startsWith("/anthropic/") || pathname.startsWith("/xllmapi/") ||
      pathname === "/messages" ||
      pathname === "/healthz" || pathname === "/readyz" ||
      pathname === "/metrics" || pathname === "/version") {
    return null;
  }

  const releaseAssetFile = read_release_asset_file_(pathname);
  if (releaseAssetFile) {
    return releaseAssetFile;
  }

  // Try to serve the exact file first (for assets like .js, .css, .svg, etc.)
  let target = resolve(webRoot, pathname.replace(/^\//, ""));

  // Security: ensure target is within webRoot
  if (!target.startsWith(webRoot)) {
    return {
      statusCode: 404
    };
  }

  // If the exact file exists and is a file (not directory), serve it
  if (existsSync(target) && statSync(target).isFile()) {
    return {
      statusCode: 200,
      ...read_buffer_file_(target)
    };
  }

  if (is_asset_request_(pathname)) {
    return {
      statusCode: 404
    };
  }

  // SPA fallback: serve index.html for all page routes
  target = resolve(webRoot, "index.html");
  if (!existsSync(target)) {
    return {
      statusCode: 404
    };
  }

  return {
    statusCode: 200,
    ...read_buffer_file_(target)
  };
};

const build_ready_state_ = async () => {
  const [cacheStatus, dbReady] = await Promise.all([
    cacheService.getStatus(),
    platformService.checkHealth()
  ]);

  const cacheReady = !config.redisUrl || cacheStatus.connected;
  const ready = !isShuttingDown && dbReady && cacheReady;

  return {
    ready,
    dbReady,
    cacheStatus
  };
};

const send_json_ = (res: import("node:http").ServerResponse, statusCode: number, body: unknown) => {
  const response = json(statusCode, body);
  res.writeHead(response.statusCode, response.headers);
  res.end(response.payload);
};

const send_text_ = (res: import("node:http").ServerResponse, statusCode: number, payload: string) => {
  res.writeHead(statusCode, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "content-length": Buffer.byteLength(payload).toString()
  });
  res.end(payload);
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
      send_json_(res, 200, {
        ok: true,
        service: "platform-api",
        env: config.envMode,
        releaseId: config.releaseId,
        db: {
          driver: config.dbDriver,
          databaseUrlConfigured: Boolean(config.databaseUrl),
          sqliteDbPathConfigured: Boolean(config.sqliteDbPath)
        },
        cache: cacheStatus,
        requestId
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/readyz") {
      const readyState = await build_ready_state_();
      send_json_(res, readyState.ready ? 200 : 503, {
        ok: readyState.ready,
        service: "platform-api",
        env: config.envMode,
        releaseId: config.releaseId,
        draining: isShuttingDown,
        dbReady: readyState.dbReady,
        cache: readyState.cacheStatus,
        requestId
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/version") {
      send_json_(res, 200, {
        ok: true,
        service: "platform-api",
        env: config.envMode,
        releaseId: config.releaseId,
        requestId
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      const payload = metricsService.renderPrometheus({
        env: config.envMode,
        release_id: config.releaseId
      });
      send_text_(res, 200, `${payload}\n`);
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
      if (staticFile.statusCode === 404) {
        send_json_(res, 404, {
          error: {
            message: "Not found",
            requestId
          }
        });
        return;
      }

      const headers: Record<string, string> = {
        "content-type": staticFile.contentType,
        "content-length": staticFile.content.byteLength.toString()
      };

      if (url.pathname.startsWith("/_releases/") || url.pathname.startsWith("/assets/")) {
        headers["cache-control"] = "public, max-age=31536000, immutable";
      } else {
        headers["cache-control"] = "no-store";
      }

      res.writeHead(staticFile.statusCode, headers);
      res.end(staticFile.content);
      return;
    }

    // --- Route dispatch ---
    if (await handleAuthRoutes(req, res, url, requestId)) return;
    if (await handleUserRoutes(req, res, url, requestId)) return;
    if (await handleApiProxyRoutes(req, res, url, requestId)) return;
    if (await handleChatRoutes(req, res, url, requestId)) return;
    if (await handleNetworkRoutes(req, res, url, requestId)) return;
    if (await handleMarketRoutes(req, res, url, requestId)) return;
    if (await handlePublicRoutes(req, res, url, requestId)) return;
    if (await handleProviderRoutes(req, res, url, requestId)) return;
    if (await handleUsageRoutes(req, res, url, requestId)) return;
    if (await handleNotificationRoutes(req, res, url, requestId)) return;
    if (await handleNodeRoutes(req, res, url, requestId)) return;
    if (await handleAdminRoutes(req, res, url, requestId)) return;

    // --- Internal debug ---
    if (!config.isProduction && req.method === "GET" && url.pathname === "/internal/debug/state") {
      send_json_(res, 200, {
        requestId,
        state: await platformService.getDebugState(),
        devApiKey: DEV_USER_API_KEY,
        devAdminApiKey: DEV_ADMIN_API_KEY
      });
      return;
    }

    // --- 404 ---
    send_json_(res, 404, {
      error: {
        message: "Not found",
        requestId
      }
    });
  } catch (error) {
    if (error instanceof AppError) {
      send_json_(res, error.statusCode, {
        error: {
          code: error.code,
          message: error.message,
          requestId
        }
      });
      return;
    }

    console.error("[server] request failed", error);
    send_json_(res, 500, {
      error: {
        code: "internal_error",
        message: "internal server error",
        requestId
      }
    });
  }
});

server.on('upgrade', (req, socket, head) => {
  if (isShuttingDown) {
    socket.destroy();
    return;
  }
  const upgradeUrl = new URL(req.url ?? '', `http://${req.headers.host}`);
  if (upgradeUrl.pathname === '/ws/node') {
    nodeConnectionManager.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`platform-api listening on http://${host}:${port}`);
  // PM2 cluster ready signal — new worker is ready to accept traffic
  if (typeof process.send === "function") {
    process.send("ready");
  }
});

// ── Graceful shutdown ──────────────────────────────────────────────
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] received ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("[shutdown] HTTP server closed");
  });

  // Close WebSocket server
  try {
    nodeConnectionManager.shutdown();
  } catch { /* ignore */ }

  // Wait for in-flight requests (max 30s)
  const timeout = setTimeout(() => {
    console.log("[shutdown] timeout reached, forcing exit");
    process.exit(1);
  }, 30_000);

  // Close database pool
  try {
    const { closePool } = await import("./repositories/postgres-platform-repository.js");
    await closePool();
    console.log("[shutdown] database pool closed");
  } catch { /* ignore */ }

  // Close Redis
  try {
    await cacheService.close();
    console.log("[shutdown] cache closed");
  } catch { /* ignore */ }

  clearTimeout(timeout);
  console.log("[shutdown] done");
  process.exit(0);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
