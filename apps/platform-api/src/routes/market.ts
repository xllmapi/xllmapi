import type { IncomingMessage, ServerResponse } from "node:http";

import {
  json,
  read_json,
  authenticate_request_,
  authenticate_session_only_,
  unauthorized_
} from "../lib/http.js";
import { platformService } from "../services/platform-service.js";

export async function handleMarketRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string
): Promise<boolean> {

  // ---- Public market listings (optional auth for myVote) ----

  if (req.method === "GET" && url.pathname === "/v1/market/offerings") {
    let userId: string | undefined;
    try {
      const auth = await authenticate_request_(req);
      if (auth) userId = auth.userId;
    } catch { /* ignore */ }

    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const executionMode = url.searchParams.get("executionMode") ?? undefined;
    const logicalModel = url.searchParams.get("logicalModel") ?? undefined;
    const sort = url.searchParams.get("sort") ?? undefined;

    const data = await platformService.listMarketOfferings({ page, limit, executionMode, logicalModel, sort });
    const response = json(200, { object: "list", requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const marketOfferingMatch = req.method === "GET"
    ? url.pathname.match(/^\/v1\/market\/offerings\/([^/]+)$/)
    : null;
  if (marketOfferingMatch) {
    let userId: string | undefined;
    try {
      const auth = await authenticate_request_(req);
      if (auth) userId = auth.userId;
    } catch { /* ignore */ }

    const offeringId = marketOfferingMatch[1];
    const data = await platformService.getMarketOffering(offeringId, userId);
    if (!data) {
      const response = json(404, { error: { message: "offering not found", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // ---- Public user profiles ----

  const userProfileMatch = req.method === "GET"
    ? url.pathname.match(/^\/v1\/users\/([^/]+)\/profile$/)
    : null;
  if (userProfileMatch) {
    const handle = userProfileMatch[1];
    const data = await platformService.getPublicUserProfile(handle);
    if (!data) {
      const response = json(404, { error: { message: "user not found", requestId } });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const response = json(200, { requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const userOfferingsMatch = req.method === "GET"
    ? url.pathname.match(/^\/v1\/users\/([^/]+)\/offerings$/)
    : null;
  if (userOfferingsMatch) {
    const handle = userOfferingsMatch[1];
    const data = await platformService.listUserOfferings(handle);
    const response = json(200, { object: "list", requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // ---- Votes (authenticated) ----

  const voteMatch = url.pathname.match(/^\/v1\/offerings\/([^/]+)\/vote$/);
  if (voteMatch) {
    const offeringId = voteMatch[1];

    if (req.method === "POST") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      const body = await read_json<{ vote: string }>(req);
      if (body.vote !== "upvote" && body.vote !== "downvote") {
        const response = json(400, { error: { message: "vote must be 'upvote' or 'downvote'", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      await platformService.castVote(auth.userId, offeringId, body.vote);
      const data = await platformService.getVoteSummary(offeringId, auth.userId);
      const response = json(200, { requestId, data });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (req.method === "DELETE") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      await platformService.removeVote(auth.userId, offeringId);
      const data = await platformService.getVoteSummary(offeringId, auth.userId);
      const response = json(200, { requestId, data });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
  }

  // ---- Favorites (authenticated) ----

  const favoriteMatch = url.pathname.match(/^\/v1\/offerings\/([^/]+)\/favorite$/);
  if (favoriteMatch) {
    const offeringId = favoriteMatch[1];

    if (req.method === "POST") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      await platformService.addFavorite(auth.userId, offeringId);
      const response = json(200, { requestId, ok: true });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (req.method === "DELETE") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      await platformService.removeFavorite(auth.userId, offeringId);
      const response = json(200, { requestId, ok: true });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
  }

  // ---- Comments ----

  const commentsMatch = url.pathname.match(/^\/v1\/offerings\/([^/]+)\/comments$/);
  if (commentsMatch) {
    const offeringId = commentsMatch[1];

    if (req.method === "GET") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const data = await platformService.listComments(offeringId, page, limit);
      const response = json(200, { object: "list", requestId, data });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (req.method === "POST") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      const body = await read_json<{ content: string }>(req);
      if (!body.content || !body.content.trim()) {
        const response = json(400, { error: { message: "content is required", requestId } });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      const data = await platformService.addComment(auth.userId, offeringId, body.content.trim());
      const response = json(201, { requestId, data });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
  }

  // DELETE /v1/comments/:commentId
  const deleteCommentMatch = req.method === "DELETE"
    ? url.pathname.match(/^\/v1\/comments\/([^/]+)$/)
    : null;
  if (deleteCommentMatch) {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const commentId = deleteCommentMatch[1];
    await platformService.deleteComment(auth.userId, commentId);
    const response = json(200, { requestId, ok: true });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  // ---- Connection Pool ----

  if (req.method === "GET" && url.pathname === "/v1/me/connection-pool") {
    const auth = await authenticate_session_only_(req);
    if (!auth) {
      const response = unauthorized_(requestId);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
    const data = await platformService.listConnectionPool(auth.userId);
    const response = json(200, { object: "list", requestId, data });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
    return true;
  }

  const poolMatch = url.pathname.match(/^\/v1\/me\/connection-pool\/([^/]+)$/);
  if (poolMatch) {
    const offeringId = poolMatch[1];

    if (req.method === "POST") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      await platformService.joinConnectionPool(auth.userId, offeringId);
      const response = json(200, { requestId, ok: true });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    if (req.method === "DELETE") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      await platformService.leaveConnectionPool(auth.userId, offeringId);
      const response = json(200, { requestId, ok: true });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }

    // PATCH — pause/resume offering in usage list
    if (req.method === "PATCH") {
      const auth = await authenticate_session_only_(req);
      if (!auth) {
        const response = unauthorized_(requestId);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.payload);
        return true;
      }
      const body = await read_json<{ paused: boolean }>(req);
      await platformService.toggleConnectionPoolPause(auth.userId, offeringId, body.paused);
      const response = json(200, { requestId, ok: true });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return true;
    }
  }

  return false;
}
