import type { IncomingMessage, ServerResponse } from "node:http";

import { randomUUID } from "node:crypto";

import {
  json,
  read_json,
  authenticate_request_,
  authenticate_session_only_,
  unauthorized_,
  forbidden_,
  match_id_route_,
  type ReviewOfferingBody,
  type InvitationBody
} from "../lib/http.js";
import { readdir, readFile } from "node:fs/promises";
import { metricsService } from "../metrics.js";
import { config } from "../config.js";
import { platformService } from "../services/platform-service.js";
import { platformRepository } from "../repositories/index.js";

// ── lightweight admin read-cache ──────────────────────────
const adminCache = new Map<string, { data: unknown; expiresAt: number }>();

function cachedAdminRead<T>(key: string, ttlMs: number, fn: () => Promise<T> | T): Promise<T> {
  const hit = adminCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  const result = Promise.resolve(fn());
  result.then((data) => adminCache.set(key, { data, expiresAt: Date.now() + ttlMs }));
  return result;
}

export async function handleAdminRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  if (req.method === "GET" && url.pathname === "/v1/admin/offerings/pending") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (auth.role !== "admin") {
      const response = forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, {
      object: "list",
      data: await platformService.listPendingOfferings()
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/invitations/all") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const data = await platformService.getAdminAllInvitations(limit);
    const response = json(200, { object: "list", requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/invitations") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { object: "list", data: await platformService.listAdminInvitations() });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/users") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { object: "list", data: await platformService.listAdminUsers() });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/admin/invitations") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<InvitationBody>(req);
    if (!body.email) {
      const response = json(400, { error: { message: "email is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.createAdminInvitation({
      inviterUserId: auth.userId,
      invitedEmail: body.email,
      note: body.note
    });
    if (!result.ok) {
      const response = json(409, { error: { code: result.code, message: result.message, requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(201, { requestId, data: result.data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/usage") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? Number(daysParam) : undefined;
    const response = json(200, { requestId, data: await platformService.getAdminUsageSummary(days) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/usage/recent") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const response = json(200, { requestId, data: await platformService.getAdminUsageRecent(limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/stats") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const data = await cachedAdminRead("admin:stats", 5 * 60_000, () => platformService.getAdminStats());
    const response = json(200, { requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "PATCH") {
    const userId = match_id_route_(url.pathname, "/v1/admin/users/");
    if (userId) {
      const auth = await authenticate_session_only_(req);
      if (!auth || auth.role !== "admin") {
        const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      const body = await read_json<{ role?: string; status?: string; walletAdjust?: number; walletAdjustNote?: string }>(req);
      const result = await platformService.updateAdminUser(userId, body, auth.userId);
      const response = json(200, { requestId, data: result });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/providers") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const data = await cachedAdminRead("admin:providers", 10 * 60_000, () => platformService.getAdminProviders());
    const response = json(200, { requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/config") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const data = await cachedAdminRead("admin:config", 30 * 60_000, () => platformService.getAdminConfig());
    const response = json(200, { requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/v1/admin/config") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ key: string; value: string }>(req);
    if (!body.key) {
      const response = json(400, { error: { message: "key is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.updateAdminConfig(body.key, body.value, auth.userId);
    adminCache.delete("admin:config");
    const response = json(200, { requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/requests") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? Number(daysParam) : undefined;
    const model = url.searchParams.get("model") || undefined;
    const provider = url.searchParams.get("provider") || undefined;
    const user = url.searchParams.get("user") || undefined;
    const result = await platformService.getAdminRequests({ model, provider, user, days, page, limit });
    const response = json(200, { requestId, ...result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // GET /v1/admin/requests/:id — request detail
  const requestDetailMatch = url.pathname.match(/^\/v1\/admin\/requests\/([^/]+)$/);
  if (req.method === "GET" && requestDetailMatch && url.pathname !== "/v1/admin/requests") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const reqId = decodeURIComponent(requestDetailMatch[1]);
    const detail = await platformRepository.getAdminRequestDetail(reqId);
    if (!detail) {
      const response = json(404, { error: { code: "not_found", message: "request not found", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { ok: true, data: detail, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // ── Offering Health ─────────────────────────────────────────────────

  // GET /v1/admin/offering-health — list all offerings with breaker state
  if (req.method === "GET" && url.pathname === "/v1/admin/offering-health") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const { getAllBreakerStates } = await import("@xllmapi/core");
    const breakers = getAllBreakerStates();
    // Get all active offerings from DB
    const offerings = await platformRepository.getAdminOfferingHealthList();
    // Merge breaker state
    const data = offerings.map((o: Record<string, unknown>) => {
      const bs = breakers.get(o.offeringId as string);
      return {
        ...o,
        breakerState: bs?.state ?? "closed",
        errorClass: bs?.errorClass ?? null,
        failures: bs?.failures ?? 0,
        cooldownMs: bs?.cooldownMs ?? 0,
        lastFailureAt: bs?.lastFailureAt ? new Date(bs.lastFailureAt).toISOString() : null,
        lastErrorMessage: bs?.lastErrorMessage ?? null,
        autoDisabled: bs?.autoDisabled ?? false,
      };
    });
    const response = json(200, { ok: true, data, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // POST /v1/admin/offering-health/:id/reset — manual breaker reset
  const healthResetMatch = url.pathname.match(/^\/v1\/admin\/offering-health\/([^/]+)\/reset$/);
  if (req.method === "POST" && healthResetMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const { resetBreaker } = await import("@xllmapi/core");
    const offeringId = decodeURIComponent(healthResetMatch[1]);
    resetBreaker(offeringId);
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "reset_breaker", targetType: "offering", targetId: offeringId, payload: {},
    });
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // POST /v1/admin/offering-health/:id/stop — admin stop offering (enabled=false)
  const healthStopMatch = url.pathname.match(/^\/v1\/admin\/offering-health\/([^/]+)\/stop$/);
  if (req.method === "POST" && healthStopMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const offeringId = decodeURIComponent(healthStopMatch[1]);
    await platformRepository.adminStopOffering(offeringId);
    const { resetBreaker } = await import("@xllmapi/core");
    resetBreaker(offeringId);
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "admin_stop", targetType: "offering", targetId: offeringId, payload: {},
    });
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // POST /v1/admin/offering-health/:id/ban — admin ban offering
  const healthBanMatch = url.pathname.match(/^\/v1\/admin\/offering-health\/([^/]+)\/ban$/);
  if (req.method === "POST" && healthBanMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const offeringId = decodeURIComponent(healthBanMatch[1]);
    await platformRepository.adminBanOffering(offeringId);
    const { resetBreaker } = await import("@xllmapi/core");
    resetBreaker(offeringId);
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "admin_ban", targetType: "offering", targetId: offeringId, payload: {},
    });
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // POST /v1/admin/offering-health/:id/unban — admin unban offering
  const healthUnbanMatch = url.pathname.match(/^\/v1\/admin\/offering-health\/([^/]+)\/unban$/);
  if (req.method === "POST" && healthUnbanMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const offeringId = decodeURIComponent(healthUnbanMatch[1]);
    await platformRepository.adminUnbanOffering(offeringId);
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "admin_unban", targetType: "offering", targetId: offeringId, payload: {},
    });
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // POST /v1/admin/offering-health/:id/start — admin start offering (only if admin_stop)
  const healthStartMatch = url.pathname.match(/^\/v1\/admin\/offering-health\/([^/]+)\/start$/);
  if (req.method === "POST" && healthStartMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const offeringId = decodeURIComponent(healthStartMatch[1]);
    await platformRepository.adminStartOffering(offeringId);
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "admin_start", targetType: "offering", targetId: offeringId, payload: {},
    });
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // DELETE /v1/admin/offering-health/:id — admin delete orphaned offering
  const healthDeleteMatch = url.pathname.match(/^\/v1\/admin\/offering-health\/([^/]+)$/);
  if (req.method === "DELETE" && healthDeleteMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const offeringId = decodeURIComponent(healthDeleteMatch[1]);
    await platformRepository.adminDeleteOffering(offeringId);
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "admin_delete_offering", targetType: "offering", targetId: offeringId, payload: {},
    });
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // GET /v1/admin/offering-health/:id/stats — offering request stats
  const healthStatsMatch = url.pathname.match(/^\/v1\/admin\/offering-health\/([^/]+)\/stats$/);
  if (req.method === "GET" && healthStatsMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const offeringId = decodeURIComponent(healthStatsMatch[1]);
    const stats = await platformRepository.getOfferingStats(offeringId);
    const response = json(200, { ok: true, data: stats, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/settlements") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? Number(daysParam) : undefined;
    const result = await platformService.getAdminSettlements({ days, page, limit });
    const response = json(200, { requestId, ...result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/settlement-failures") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const statusParam = url.searchParams.get("status");
    const status = statusParam === "resolved" || statusParam === "all" ? statusParam : "open";
    const result = await platformService.getAdminSettlementFailures({ page, limit, status });
    const response = json(200, { requestId, ...result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const settlementFailureRetryMatch = req.method === "POST"
    ? url.pathname.match(/^\/v1\/admin\/settlement-failures\/([^/]+)\/retry$/)
    : null;
  if (settlementFailureRetryMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const failureId = decodeURIComponent(settlementFailureRetryMatch[1]);
    const result = await platformService.retrySettlementFailure({ failureId, actorUserId: auth.userId });
    const response = result.ok
      ? json(200, { requestId, data: result.data })
      : json(result.code === "not_found" ? 404 : 409, {
          error: {
            code: result.code,
            message: result.message,
            requestId
          }
        });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }
  // GET /v1/admin/logs — read PM2 log files
  if (req.method === "GET" && url.pathname === "/v1/admin/logs") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 1000);
    const level = url.searchParams.get("level") ?? "";
    const search = url.searchParams.get("search") ?? "";

    const { readFileSync, existsSync } = await import("node:fs");

    // Merge out.log + error.log (production) or platform.log (dev)
    const prodLogs = ["/var/log/xllmapi/out.log", "/var/log/xllmapi/error.log"];
    const devLogs = ["/tmp/xllmapi-dev/platform.log"];
    const logSets = existsSync(prodLogs[0]!) ? prodLogs : devLogs;

    // Read lines with source tag (error.log lines default to error level)
    const taggedLines: Array<{ line: string; source: "out" | "error" | "dev" }> = [];
    for (const p of logSets) {
      if (!existsSync(p!)) continue;
      try {
        const content = readFileSync(p!, "utf-8");
        const lines = content.split("\n").filter(Boolean).slice(-limit * 3);
        const source = p!.includes("error.log") ? "error" as const : p!.includes("out.log") ? "out" as const : "dev" as const;
        for (const line of lines) taggedLines.push({ line, source });
      } catch { /* skip */ }
    }

    // Parse and merge multi-line entries
    const PM2_RE = /^\d+\|\w+\s*\|\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[+-]\d{2}:\d{2}):\s*(.*)/;

    function detectLevel(msg: string, source: string): string {
      if (source === "error") return "error";
      if (msg.includes("error:") || msg.includes("Error:") || msg.includes("request failed")) return "error";
      if (msg.includes("WARN") || msg.includes("warning")) return "warn";
      return "info";
    }

    type LogEntry = { timestamp: string; level: string; message: string; module?: string; raw: string };
    const entries: LogEntry[] = [];
    let current: LogEntry | null = null;

    for (const { line, source } of taggedLines) {
      // Try JSON
      try {
        const obj = JSON.parse(line);
        if (obj.timestamp) {
          if (current) entries.push(current);
          current = { timestamp: obj.timestamp, level: obj.level ?? "info", message: obj.message ?? "", module: obj.module ?? "", raw: line };
          continue;
        }
      } catch { /* not JSON */ }

      // PM2 format — starts a new entry
      const pm2Match = line.match(PM2_RE);
      if (pm2Match) {
        if (current) entries.push(current);
        const msg = pm2Match[2]!;
        const modMatch = msg.match(/^\[([^\]]+)\]/);
        current = {
          timestamp: new Date(pm2Match[1]!).toISOString(),
          level: detectLevel(msg, source),
          message: msg,
          module: modMatch?.[1] ?? "",
          raw: line,
        };
        continue;
      }

      // Continuation line (no timestamp) — merge into current entry
      if (current) {
        current.message += "\n" + line.replace(/^\d+\|\w+\s*\|\s*/, "");
        current.raw += "\n" + line;
      } else if (line.trim()) {
        // Orphan line
        entries.push({ timestamp: "", level: source === "error" ? "error" : "info", message: line.replace(/^\d+\|\w+\s*\|\s*/, ""), raw: line });
      }
    }
    if (current) entries.push(current);

    // Sort by timestamp
    const parsed = entries;
    parsed.sort((a, b) => (a.timestamp > b.timestamp ? 1 : a.timestamp < b.timestamp ? -1 : 0));

    let filtered = parsed;
    if (level) filtered = filtered.filter(l => l.level === level.toLowerCase());
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(l => l.raw.toLowerCase().includes(s));
    }

    const data = filtered.slice(-limit).reverse(); // newest first
    const response = json(200, { ok: true, data, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/audit-logs") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const response = json(200, { requestId, data: await platformService.getAdminAuditLogs(limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/email-deliveries") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const response = json(200, { requestId, data: await platformService.listAdminEmailDeliveries(limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/security-events") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const response = json(200, { requestId, data: await platformService.listAdminSecurityEvents(limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/v1/admin/notifications") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ title: string; body?: string; content?: string; type?: string; targetUserId?: string; targetHandle?: string; sendEmail?: boolean }>(req);
    const notifContent = body.body ?? body.content ?? "";
    if (!body.title || !notifContent) {
      const response = json(400, { error: { message: "title and content are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    // Resolve targetHandle to targetUserId
    let targetUserId = body.targetUserId ?? null;
    if (!targetUserId && body.targetHandle) {
      const resolved = await platformService.findUserByHandle(body.targetHandle);
      if (!resolved) {
        const response = json(404, { error: { message: `user not found: ${body.targetHandle}`, requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      targetUserId = resolved.id;
    }
    const result = await platformService.createNotification({
      id: randomUUID(),
      title: body.title,
      body: notifContent,
      type: body.type ?? "announcement",
      targetUserId,
      createdBy: auth.userId
    });
    // Send email if requested for personal notifications
    if (body.sendEmail && body.type === "personal" && targetUserId) {
      try {
        const { emailSender, renderTransactionalEmail } = await import("../email.js");
        // Get user email
        const userIdentity = await platformRepository.getUserEmailByUserId(targetUserId);
        if (userIdentity?.email) {
          const rendered = renderTransactionalEmail("admin_notification", { code: notifContent });
          await emailSender.send({
            templateKey: "admin_notification",
            toEmail: userIdentity.email,
            subject: `[xllmapi] ${body.title}`,
            html: rendered.html,
            text: rendered.text,
          });
          // Record email delivery
          await platformRepository.recordEmailDeliveryAttempt({
            id: `mail_${randomUUID()}`,
            provider: "email",
            templateKey: "admin_notification",
            toEmail: userIdentity.email,
            subject: `[xllmapi] ${body.title}`,
            challengeId: null,
            status: "sent",
            providerMessageId: null,
            payload: { notificationId: result.id },
          });
        }
      } catch (emailError) {
        console.error("[admin] failed to send notification email:", emailError);
        // Don't fail the notification creation, just log the email error
      }
    }
    const response = json(201, { requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/notifications") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const result = await platformService.listAdminNotifications({ page, limit });
    const response = json(200, { requestId, data: result.data, total: result.total });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const reviewMatch = req.method === "POST"
    ? url.pathname.match(/^\/v1\/admin\/offerings\/([^/]+)\/review$/)
    : null;
  if (reviewMatch) {
    const auth = await authenticate_request_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (auth.role !== "admin") {
      const response = forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const offeringId = reviewMatch[1];
    const body = await read_json<ReviewOfferingBody>(req);
    if (body.reviewStatus !== "approved" && body.reviewStatus !== "rejected") {
      const response = json(400, {
        error: {
          message: "reviewStatus must be approved or rejected",
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const reviewResult = await platformService.reviewOffering({
      offeringId,
      reviewStatus: body.reviewStatus
    });

    if (!reviewResult.ok) {
      const response = json(reviewResult.code === "not_found" ? 404 : 409, {
        error: {
          message: reviewResult.message,
          code: reviewResult.code,
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    await platformService.writeAuditLog({
      actorUserId: auth.userId,
      action: "offering.reviewed",
      targetType: "offering",
      targetId: offeringId,
      payload: {
        reviewStatus: body.reviewStatus
      }
    });

    const response = json(200, {
      requestId,
      data: reviewResult.data
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // --- Provider Presets ---

  // GET /v1/admin/provider-presets
  if (req.method === "GET" && url.pathname === "/v1/admin/provider-presets") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const presets = await platformService.listProviderPresets();
    const response = json(200, { ok: true, data: presets, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // GET /v1/admin/provider-presets/audit-log
  if (req.method === "GET" && url.pathname === "/v1/admin/provider-presets/audit-log") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const currentPool = (await import("../repositories/index.js")).platformRepository;
    const result = await currentPool.getAuditLogsByTargetType("provider_preset", limit, page);
    const response = json(200, { ok: true, data: result.data, total: result.total, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // POST /v1/admin/provider-presets/validate-api
  if (req.method === "POST" && url.pathname === "/v1/admin/provider-presets/validate-api") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ baseUrl?: string; anthropicBaseUrl?: string; apiKey: string; testModel?: string }>(req);
    if (!body.apiKey) {
      const response = json(400, { error: { code: "invalid_request", message: "apiKey is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    if (!body.baseUrl && !body.anthropicBaseUrl) {
      const response = json(400, { error: { code: "invalid_request", message: "at least one URL is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.validateApiCompliance({
      baseUrl: body.baseUrl ?? "",
      anthropicBaseUrl: body.anthropicBaseUrl ?? "",
      apiKey: body.apiKey,
      testModel: body.testModel,
    });
    const response = json(200, { ok: true, data: result, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // PUT /v1/admin/provider-presets/:id  &  DELETE /v1/admin/provider-presets/:id
  const presetMatch = url.pathname.match(/^\/v1\/admin\/provider-presets\/([^/]+)$/);

  if (req.method === "PUT" && presetMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const presetId = decodeURIComponent(presetMatch[1]);
    const body = await read_json<{ label: string; providerType: string; baseUrl: string; anthropicBaseUrl?: string; models?: unknown[]; enabled?: boolean; sortOrder?: number; customHeaders?: unknown; thirdParty?: boolean; thirdPartyLabel?: string; trustLevel?: string; thirdPartyNotice?: string }>(req);
    // Validate: at least one URL required, and must match API format
    const hasBaseUrl = !!(body.baseUrl && body.baseUrl.trim());
    const hasAnthropicUrl = !!(body.anthropicBaseUrl && body.anthropicBaseUrl.trim());
    if (!hasBaseUrl && !hasAnthropicUrl) {
      const response = json(400, { error: { code: "invalid_request", message: "at least one URL (baseUrl or anthropicBaseUrl) is required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    if (body.providerType === "anthropic" && !hasAnthropicUrl) {
      const response = json(400, { error: { code: "invalid_request", message: "anthropicBaseUrl is required for Anthropic format", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    if (body.providerType !== "anthropic" && !hasBaseUrl) {
      const response = json(400, { error: { code: "invalid_request", message: "baseUrl is required for OpenAI/OpenAI-compatible format", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    // Get old values for audit diff before update
    let oldPreset: Record<string, unknown> | null = null;
    try {
      oldPreset = await platformRepository.getProviderPresetRaw(presetId);
    } catch { /* best-effort, don't block update */ }

    await platformService.upsertProviderPreset({
      id: presetId,
      label: body.label,
      providerType: body.providerType,
      baseUrl: body.baseUrl,
      anthropicBaseUrl: body.anthropicBaseUrl,
      models: body.models || [],
      enabled: body.enabled,
      sortOrder: body.sortOrder,
      updatedBy: auth.userId,
      customHeaders: body.customHeaders ?? null,
      thirdParty: body.thirdParty ?? false,
      thirdPartyLabel: body.thirdPartyLabel ?? null,
      trustLevel: body.trustLevel ?? "high",
      thirdPartyNotice: body.thirdPartyNotice ?? null,
    });

    // Compute diff for audit log
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (oldPreset) {
      const trackFields = ["label", "provider_type", "base_url", "anthropic_base_url", "enabled", "sort_order", "models", "custom_headers", "third_party", "third_party_label", "trust_level", "third_party_notice"];
      for (const field of trackFields) {
        const camelField = field.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
        const oldVal = oldPreset[field];
        const newVal = (body as any)[camelField] ?? null;
        const oldStr = typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal ?? '');
        const newStr = typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal ?? '');
        if (oldStr !== newStr) {
          changes[camelField] = { old: oldVal, new: newVal };
        }
      }
    }

    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "update", targetType: "provider_preset", targetId: presetId,
      payload: { label: body.label, providerType: body.providerType, baseUrl: body.baseUrl, changes },
    });
    const response = json(200, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // POST /v1/admin/provider-presets
  if (req.method === "POST" && url.pathname === "/v1/admin/provider-presets") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ id?: string; label?: string; providerType?: string; baseUrl?: string; anthropicBaseUrl?: string; models?: unknown[]; enabled?: boolean; sortOrder?: number; customHeaders?: unknown; thirdParty?: boolean; thirdPartyLabel?: string; trustLevel?: string; thirdPartyNotice?: string }>(req);
    const hasBaseUrl = !!(body.baseUrl && body.baseUrl.trim());
    const hasAnthropicUrl = !!(body.anthropicBaseUrl && body.anthropicBaseUrl.trim());
    if (!body.id || !body.label || !body.providerType || (!hasBaseUrl && !hasAnthropicUrl)) {
      const response = json(400, { error: { code: "invalid_request", message: "id, label, providerType, and at least one URL are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    if (body.providerType === "anthropic" && !hasAnthropicUrl) {
      const response = json(400, { error: { code: "invalid_request", message: "anthropicBaseUrl is required for Anthropic format", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    if (body.providerType !== "anthropic" && !hasBaseUrl) {
      const response = json(400, { error: { code: "invalid_request", message: "baseUrl is required for OpenAI/OpenAI-compatible format", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    await platformService.upsertProviderPreset({
      id: body.id,
      label: body.label,
      providerType: body.providerType,
      baseUrl: body.baseUrl ?? "",
      anthropicBaseUrl: body.anthropicBaseUrl,
      models: body.models || [],
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
      updatedBy: auth.userId,
      customHeaders: body.customHeaders ?? null,
      thirdParty: body.thirdParty ?? false,
      thirdPartyLabel: body.thirdPartyLabel ?? null,
      trustLevel: body.trustLevel ?? "high",
      thirdPartyNotice: body.thirdPartyNotice ?? null,
    });
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "create", targetType: "provider_preset", targetId: body.id,
      payload: { label: body.label, providerType: body.providerType, baseUrl: body.baseUrl },
    });
    const response = json(201, { ok: true, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // DELETE /v1/admin/provider-presets/:id
  if (req.method === "DELETE" && presetMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const presetIdToDelete = decodeURIComponent(presetMatch[1]);
    const deleted = await platformService.deleteProviderPreset(presetIdToDelete);
    if (deleted) {
      await platformRepository.writeAuditLog({
        actorUserId: auth.userId, action: "delete", targetType: "provider_preset", targetId: presetIdToDelete,
        payload: {},
      });
    }
    const response = json(deleted ? 200 : 404, { ok: deleted, requestId });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // DELETE /v1/admin/comments/:id — admin delete comment
  const adminDeleteCommentMatch = req.method === "DELETE"
    ? url.pathname.match(/^\/v1\/admin\/comments\/([^/]+)$/)
    : null;
  if (adminDeleteCommentMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const commentId = adminDeleteCommentMatch[1];
    await platformService.adminDeleteComment(commentId);
    const response = json(200, { requestId, ok: true });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/admin/releases") {
    const auth = await authenticate_session_only_(req);
    if (!auth || auth.role !== "admin") {
      const response = !auth ? unauthorized_(requestId) : forbidden_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const releasesDir = "/opt/xllmapi/app/releases";
    const releases: Array<{ releaseId: string; deployedAt: string; gitCommit: string; backupPath: string | null; status: string }> = [];

    try {
      const files = await readdir(releasesDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const content = await readFile(`${releasesDir}/${file}`, "utf-8");
          const record = JSON.parse(content);
          releases.push({
            releaseId: record.releaseId ?? file.replace(/\.json$/, ""),
            deployedAt: record.deployedAt ?? "",
            gitCommit: record.gitCommit ?? "",
            backupPath: record.backupPath ?? null,
            status: record.status ?? "unknown",
          });
        } catch { /* skip malformed files */ }
      }
      // Sort by deployedAt descending
      releases.sort((a, b) => (b.deployedAt || "").localeCompare(a.deployedAt || ""));
    } catch {
      // releases dir doesn't exist — return current release as single item
      releases.push({
        releaseId: config.releaseId,
        deployedAt: new Date().toISOString(),
        gitCommit: "",
        backupPath: null,
        status: "success",
      });
    }

    const response = json(200, { requestId, data: releases });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  return false;
}
