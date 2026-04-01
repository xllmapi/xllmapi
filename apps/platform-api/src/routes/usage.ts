import type { IncomingMessage, ServerResponse } from "node:http";

import {
  json,
  authenticate_request_,
  authenticate_session_only_,
  unauthorized_
} from "../lib/http.js";
import { metricsService } from "../metrics.js";
import { platformService } from "../services/platform-service.js";

export async function handleUsageRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  if (req.method === "GET" && url.pathname === "/v1/wallet") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      metricsService.increment("authFailures");
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const balance = await platformService.getWallet(auth.userId);
    const response = json(200, {
      requestId,
      data: {
        userId: auth.userId,
        apiKeyId: "apiKeyId" in auth ? auth.apiKeyId : null,
        label: "label" in auth ? auth.label : "session",
        balance,
        unit: "token_credit"
      }
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/usage/supply") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data: await platformService.getSupplyUsage(auth.userId) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/usage/consumption") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data: await platformService.getConsumptionUsage(auth.userId) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/usage/consumption/recent") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const days = Math.min(Number(url.searchParams.get("days") ?? 30), 365);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 2000);
    const response = json(200, { requestId, data: await platformService.getConsumptionRecent(auth.userId, days, limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/usage/supply/daily") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
    const response = json(200, { requestId, data: await platformService.getSupplyDaily(auth.userId, year) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/usage/supply/recent") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const days = Math.min(Number(url.searchParams.get("days") ?? 30), 365);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 2000);
    const response = json(200, { requestId, data: await platformService.getSupplyRecent(auth.userId, days, limit) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/usage/consumption/daily") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
    const response = json(200, { requestId, data: await platformService.getConsumptionDaily(auth.userId, year) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/usage/consumption/by-date") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const date = url.searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const response = json(400, { error: { message: "date parameter required (YYYY-MM-DD)", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data: await platformService.getConsumptionByDate(auth.userId, date) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/ledger") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const entryType = url.searchParams.get("type") ?? undefined;
    const { ledgerService } = await import("../services/ledger-service.js");
    const result = await ledgerService.getLedgerHistory({
      userId: auth.userId,
      limit,
      offset,
      entryType,
    });
    const response = json(200, { requestId, data: result.data, total: result.total });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  return false;
}
