import type { IncomingMessage, ServerResponse } from "node:http";

import {
  json,
  authenticate_request_,
  unauthorized_
} from "../lib/http.js";
import { platformService } from "../services/platform-service.js";

export async function handleNetworkRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  if (req.method === "GET" && url.pathname === "/v1/models") {
    const response = json(200, {
      object: "list",
      data: await platformService.listMarketModels()
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/network/models") {
    const response = json(200, {
      object: "list",
      data: await platformService.listMarketModels()
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/network/trends") {
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 90);
    const response = json(200, {
      requestId,
      data: await platformService.getNetworkTrends(days)
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/network/models/stats") {
    const response = json(200, {
      requestId,
      data: await platformService.getNetworkModelStats()
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // GET /v1/network/node/:publicNodeId — public node detail page
  const nodePublicMatch = req.method === "GET"
    ? url.pathname.match(/^\/v1\/network\/node\/([^/]+)$/)
    : null;
  if (nodePublicMatch) {
    const publicNodeId = nodePublicMatch[1];
    const data = await platformService.getNodeByPublicId(publicNodeId);
    if (!data) {
      const response = json(404, { error: { message: "node not found", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/pricing/guidance") {
    const auth = await authenticate_request_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const logicalModel = url.searchParams.get("logicalModel")?.trim();
    if (!logicalModel) {
      const response = json(400, {
        error: {
          message: "logicalModel is required",
          requestId
        }
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    const response = json(200, {
      requestId,
      data: await platformService.getPricingGuidance(logicalModel)
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  return false;
}
