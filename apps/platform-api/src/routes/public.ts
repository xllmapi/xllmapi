import type { IncomingMessage, ServerResponse } from "node:http";

import { json } from "../lib/http.js";
import { platformService } from "../services/platform-service.js";

export async function handlePublicRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  const publicSupplierMatch = req.method === "GET"
    ? url.pathname.match(/^\/v1\/public\/users\/([^/]+)$/)
    : null;
  if (publicSupplierMatch) {
    const handle = decodeURIComponent(publicSupplierMatch[1]);
    const profile = await platformService.getPublicSupplierProfile(handle);
    if (!profile) {
      const response = json(404, { error: { message: "supplier not found", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data: profile });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const publicSupplierOfferingsMatch = req.method === "GET"
    ? url.pathname.match(/^\/v1\/public\/users\/([^/]+)\/offerings$/)
    : null;
  if (publicSupplierOfferingsMatch) {
    const handle = decodeURIComponent(publicSupplierOfferingsMatch[1]);
    const response = json(200, {
      requestId,
      object: "list",
      data: await platformService.getPublicSupplierOfferings(handle)
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/site-banner") {
    const configRows = await platformService.getAdminConfig() as { key: string; value: string }[];
    const lookup = new Map(configRows.map((r) => [r.key, r.value]));
    const enabled = lookup.get("site_banner_enabled") === "true";
    const content = lookup.get("site_banner_content") ?? "";
    const type = lookup.get("site_banner_type") ?? "info";
    const response = json(200, {
      requestId,
      enabled,
      content: enabled ? content : "",
      type: enabled ? type : "info"
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/welcome-message") {
    const configRows = await platformService.getAdminConfig() as { key: string; value: string }[];
    const lookup = new Map(configRows.map((r) => [r.key, r.value]));
    const enabled = lookup.get("welcome_message_enabled") === "true";
    const content = lookup.get("welcome_message_content") ?? "";
    const response = json(200, {
      requestId,
      enabled,
      content: enabled ? content : ""
    });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  return false;
}
