import type { IncomingMessage, ServerResponse } from "node:http";

import {
  json,
  read_json,
  authenticate_session_only_,
  unauthorized_,
  match_id_route_
} from "../lib/http.js";
import { platformService } from "../services/platform-service.js";

export async function handleNodeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  // POST /v1/nodes/tokens — create node token
  if (req.method === "POST" && url.pathname === "/v1/nodes/tokens") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{ label: string }>(req);
    const result = await platformService.createNodeToken(auth.userId, body.label);
    const response = json(201, { requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // GET /v1/nodes/tokens — list my tokens
  if (req.method === "GET" && url.pathname === "/v1/nodes/tokens") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.listNodeTokens(auth.userId);
    const response = json(200, { requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // DELETE /v1/nodes/tokens/:id — revoke token
  if (req.method === "DELETE") {
    const tokenId = match_id_route_(url.pathname, "/v1/nodes/tokens/");
    if (tokenId) {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      const result = await platformService.revokeNodeToken(auth.userId, tokenId);
      const response = json(200, { requestId, data: result });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
  }

  // GET /v1/nodes/:id/stats — node stats
  if (req.method === "GET") {
    const statsMatch = url.pathname.match(/^\/v1\/nodes\/([^/]+)\/stats$/);
    if (statsMatch) {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      const nodeId = statsMatch[1];
      const result = await platformService.getNodeStats(nodeId);
      const response = json(200, { requestId, data: result });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
  }

  // GET /v1/nodes — list my nodes
  if (req.method === "GET" && url.pathname === "/v1/nodes") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.listUserNodes(auth.userId);
    const response = json(200, { requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // GET /v1/me/node-preferences — get preferences
  if (req.method === "GET" && url.pathname === "/v1/me/node-preferences") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const result = await platformService.getNodePreferences(auth.userId);
    const response = json(200, { requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // PUT /v1/me/node-preferences — update preferences
  if (req.method === "PUT" && url.pathname === "/v1/me/node-preferences") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const body = await read_json<{
      allowDistributedNodes: boolean;
      trustMode: string;
      trustedSupplierIds: string[];
      trustedOfferingIds: string[];
    }>(req);
    const result = await platformService.updateNodePreferences(auth.userId, body);
    const response = json(200, { requestId, data: result });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  return false;
}
