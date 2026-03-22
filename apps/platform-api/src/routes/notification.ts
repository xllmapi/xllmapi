import type { IncomingMessage, ServerResponse } from "node:http";

import {
  json,
  authenticate_session_only_,
  unauthorized_,
  match_id_route_
} from "../lib/http.js";
import { platformService } from "../services/platform-service.js";

export async function handleNotificationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  if (req.method === "GET" && url.pathname === "/v1/notifications") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data: await platformService.listUserNotifications(auth.userId) });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/v1/notifications/unread-count") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const count = await platformService.getUnreadCount(auth.userId);
    const response = json(200, { requestId, data: { count } });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  if (req.method === "POST") {
    const notifPath = url.pathname.match(/^\/v1\/notifications\/([^/]+)\/read$/);
    if (notifPath) {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      const notificationId = notifPath[1];
      const result = await platformService.markNotificationRead(notificationId, auth.userId);
      const response = json(200, { requestId, data: result });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
  }

  return false;
}
