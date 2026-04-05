// ── Unified Request Router ──────────────────────────────────────────
// Affinity-first, fastest-response routing with per-offering queues.
// Replaces duplicated routing logic in chat.ts and api-proxy.ts.

import type { CandidateOffering } from "@xllmapi/shared-types";
import { isAvailable, recordSuccess, recordFailure, getBreakerState } from "@xllmapi/core";
import { platformService } from "../services/platform-service.js";
import {
  getConvAffinity,
  setConvAffinity,
  clearConvAffinity,
  getUserAffinity,
  pushUserAffinity,
  getAffinityThresholdMs,
} from "./context-affinity.js";
import { getOrCreateQueue } from "./offering-queue.js";

// ── Offering Resolution (unified, replaces duplicated code) ────────

export async function resolveOfferings(
  logicalModel: string,
  userId?: string
): Promise<CandidateOffering[]> {
  let offerings: CandidateOffering[];

  if (userId) {
    const pool = await platformService.listConnectionPool(userId);
    if (pool.length > 0) {
      offerings = await platformService.findUserOfferingsForModel(userId, logicalModel);
      // Fallback: model not in user's connection pool → use platform offerings
      if (offerings.length === 0) {
        offerings = await platformService.findOfferingsForModel(logicalModel);
        offerings = offerings.filter(o => o.executionMode !== "node" && !o.thirdParty);
      }
    } else {
      offerings = await platformService.findOfferingsForModel(logicalModel);
      offerings = offerings.filter(o => o.executionMode !== "node" && !o.thirdParty);
    }
  } else {
    offerings = await platformService.findOfferingsForModel(logicalModel);
    offerings = offerings.filter(o => o.executionMode !== "node" && !o.thirdParty);
  }

  // Price filter
  if (userId) {
    const config = await platformService.getUserModelConfig(userId, logicalModel);
    if (config) {
      offerings = offerings.filter(o => {
        if (config.maxInputPrice != null && (o.fixedPricePer1kInput ?? 0) > config.maxInputPrice) return false;
        if (config.maxOutputPrice != null && (o.fixedPricePer1kOutput ?? 0) > config.maxOutputPrice) return false;
        return true;
      });
    }
  }

  return offerings;
}

// ── Hard Constraint Filter ─────────────────────────────────────────

async function filterAvailable(offerings: CandidateOffering[]): Promise<CandidateOffering[]> {
  const results: CandidateOffering[] = [];

  for (const o of offerings) {
    if (!isAvailable(o.offeringId)) continue;

    if (o.dailyTokenLimit && Number(o.dailyTokenLimit) > 0) {
      try {
        const used = await platformService.getOfferingDailyTokenUsage(o.offeringId);
        if (used >= Number(o.dailyTokenLimit)) continue;
      } catch (err) { console.warn(`[router] daily limit check failed for ${o.offeringId}: ${err instanceof Error ? err.message : err}`); }
    }

    const queue = getOrCreateQueue(o.offeringId, o.maxConcurrency ?? 10);
    if (queue.isFull) continue;

    results.push(o);
  }

  if (results.length > 0) return results;

  // All filtered out — allow half-open probes only (not open/disabled)
  const probes = offerings.filter(o => {
    const s = getBreakerState(o.offeringId);
    return s.state === "closed" || s.state === "half-open";
  });
  return probes;
}

// ── Offering Selection (affinity → fastest) ────────────────────────

export type AffinityLevel = "conv" | "user" | "load" | "fallback";

function selectOffering(params: {
  available: CandidateOffering[];
  conversationId?: string;
  userId?: string;
  logicalModel: string;
  messageCount: number;
}): { offering: CandidateOffering; affinityLevel: AffinityLevel } {
  const { available, conversationId, userId, logicalModel, messageCount } = params;

  // Conversation affinity
  if (conversationId) {
    const affinityId = getConvAffinity(conversationId);
    if (affinityId) {
      const offering = available.find(o => o.offeringId === affinityId);
      if (offering) {
        const queue = getOrCreateQueue(offering.offeringId, offering.maxConcurrency ?? 10);
        if (queue.estimatedWaitMs <= getAffinityThresholdMs(messageCount)) {
          return { offering, affinityLevel: "conv" };
        }
      }
    }
  }

  // User affinity
  if (userId) {
    const recentIds = getUserAffinity(userId, logicalModel);
    for (const id of recentIds) {
      const offering = available.find(o => o.offeringId === id);
      if (offering) {
        const queue = getOrCreateQueue(offering.offeringId, offering.maxConcurrency ?? 10);
        if (queue.estimatedWaitMs <= 1500) {
          return { offering, affinityLevel: "user" };
        }
      }
    }
  }

  // Load-based: sort by estimated total time with random tiebreaker, top-3 random
  const sorted = [...available].sort((a, b) => {
    const qa = getOrCreateQueue(a.offeringId, a.maxConcurrency ?? 10);
    const qb = getOrCreateQueue(b.offeringId, b.maxConcurrency ?? 10);
    const diff = qa.estimatedTotalMs - qb.estimatedTotalMs;
    return diff !== 0 ? diff : Math.random() - 0.5; // random tiebreaker
  });

  const topN = sorted.slice(0, Math.min(3, sorted.length));
  const selected = topN[Math.floor(Math.random() * topN.length)];
  return { offering: selected, affinityLevel: "load" };
}

// ── Main Router Entry ──────────────────────────────────────────────

export async function routeRequest(params: {
  logicalModel: string;
  userId?: string;
  conversationId?: string;
  requestId: string;
  messageCount: number;
}): Promise<{
  offering: CandidateOffering;
  candidates: CandidateOffering[];
  release: () => void;
  affinityLevel: AffinityLevel;
}> {
  const candidates = await resolveOfferings(params.logicalModel, params.userId);
  if (candidates.length === 0) {
    console.warn(`[router] no candidates for model=${params.logicalModel} requestId=${params.requestId}`);
    throw new Error(`no offering available for ${params.logicalModel}`);
  }

  const available = await filterAvailable(candidates);
  if (available.length === 0) {
    console.warn(`[router] all ${candidates.length} offerings filtered out for model=${params.logicalModel} requestId=${params.requestId}`);
    throw new Error(`no offering available for ${params.logicalModel} (all in cooldown)`);
  }

  if (available.length < candidates.length) {
    console.log(`[router] filtered ${candidates.length} → ${available.length} offerings for model=${params.logicalModel}`);
  }

  const { offering, affinityLevel } = selectOffering({
    available,
    conversationId: params.conversationId,
    userId: params.userId,
    logicalModel: params.logicalModel,
    messageCount: params.messageCount,
  });

  console.log(`[router] selected offering=${offering.offeringId} affinity=${affinityLevel} model=${params.logicalModel} requestId=${params.requestId}`);

  const queue = getOrCreateQueue(offering.offeringId, offering.maxConcurrency ?? 10);
  const thresholdMs = affinityLevel === "conv"
    ? getAffinityThresholdMs(params.messageCount)
    : affinityLevel === "user" ? 1500 : 3000;

  const release = await queue.acquire(thresholdMs);
  if (release) {
    return { offering, candidates: available, release, affinityLevel };
  }

  // Fallback: try another offering
  const remaining = available.filter(o => o.offeringId !== offering.offeringId);
  if (remaining.length > 0) {
    const fb = remaining[Math.floor(Math.random() * remaining.length)];
    const fbQueue = getOrCreateQueue(fb.offeringId, fb.maxConcurrency ?? 10);
    const fbRelease = await fbQueue.acquire(5000);
    if (fbRelease) {
      return { offering: fb, candidates: available, release: fbRelease, affinityLevel: "fallback" };
    }
  }

  return { offering, candidates: available, release: () => {}, affinityLevel: "fallback" };
}

// ── Post-Request Feedback ──────────────────────────────────────────

export function recordRouteResult(params: {
  success: boolean;
  conversationId?: string;
  userId?: string;
  logicalModel: string;
  offeringId: string;
  messageCount: number;
  latencyMs: number;
}): void {
  const queue = getOrCreateQueue(params.offeringId, 10);

  if (params.success) {
    queue.recordLatency(params.latencyMs);
    recordSuccess(params.offeringId);

    if (params.conversationId) {
      setConvAffinity(params.conversationId, params.offeringId, params.messageCount);
    }
    if (params.userId) {
      pushUserAffinity(params.userId, params.logicalModel, params.offeringId, params.latencyMs);
    }
  } else {
    recordFailure(params.offeringId);
    if (params.conversationId) {
      clearConvAffinity(params.conversationId);
    }
  }
}
