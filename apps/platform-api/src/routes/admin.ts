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
import { metricsService } from "../metrics.js";
import { platformService } from "../services/platform-service.js";
import { platformRepository } from "../repositories/index.js";

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
    const response = json(200, { requestId, data: await platformService.getAdminStats() });
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
      const body = await read_json<{ role?: string; status?: string; walletAdjust?: number }>(req);
      const result = await platformService.updateAdminUser(userId, body);
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
    const response = json(200, { requestId, data: await platformService.getAdminProviders() });
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
    const response = json(200, { requestId, data: await platformService.getAdminConfig() });
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
    const body = await read_json<{ title: string; body?: string; content?: string; type?: string; targetUserId?: string; targetHandle?: string }>(req);
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
    const response = json(200, { requestId, data: await platformService.listAdminNotifications() });
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
    const currentPool = (await import("../repositories/index.js")).platformRepository;
    const result = await currentPool.getAuditLogsByTargetType("provider_preset", limit);
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
    const body = await read_json<{ label: string; providerType: string; baseUrl: string; anthropicBaseUrl?: string; models?: unknown[]; enabled?: boolean; sortOrder?: number; customHeaders?: unknown }>(req);
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
    });
    await platformRepository.writeAuditLog({
      actorUserId: auth.userId, action: "update", targetType: "provider_preset", targetId: presetId,
      payload: { label: body.label, providerType: body.providerType, baseUrl: body.baseUrl },
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
    const body = await read_json<{ id?: string; label?: string; providerType?: string; baseUrl?: string; anthropicBaseUrl?: string; models?: unknown[]; enabled?: boolean; sortOrder?: number; customHeaders?: unknown }>(req);
    if (!body.id || !body.label || !body.providerType || !body.baseUrl) {
      const response = json(400, { error: { code: "invalid_request", message: "id, label, providerType, and baseUrl are required", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    await platformService.upsertProviderPreset({
      id: body.id,
      label: body.label,
      providerType: body.providerType,
      baseUrl: body.baseUrl,
      anthropicBaseUrl: body.anthropicBaseUrl,
      models: body.models || [],
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
      updatedBy: auth.userId,
      customHeaders: body.customHeaders ?? null,
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

  return false;
}
