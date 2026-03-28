// ── Context Affinity — route same conversation/user to same offering ──
// Maximizes upstream LLM prefix cache hit rate (DeepSeek/Anthropic/OpenAI)

// ── Conversation Affinity ──────────────────────────────────────────

interface ConvAffinity {
  offeringId: string;
  lastRequestAt: number;
  messageCount: number;
}

const convMap = new Map<string, ConvAffinity>();
const CONV_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function getConvAffinity(conversationId: string): string | null {
  const entry = convMap.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.lastRequestAt > CONV_TTL_MS) {
    convMap.delete(conversationId);
    return null;
  }
  return entry.offeringId;
}

export function setConvAffinity(conversationId: string, offeringId: string, messageCount: number): void {
  convMap.set(conversationId, { offeringId, lastRequestAt: Date.now(), messageCount });
}

export function clearConvAffinity(conversationId: string): void {
  convMap.delete(conversationId);
}

export function getConvAffinityEntry(conversationId: string): ConvAffinity | null {
  return convMap.get(conversationId) ?? null;
}

// ── User Model Affinity ────────────────────────────────────────────

interface UserOfferingEntry {
  offeringId: string;
  lastUsedAt: number;
  avgLatencyMs: number;
}

const userMap = new Map<string, Map<string, UserOfferingEntry[]>>();
const USER_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_RECENT = 3;

export function getUserAffinity(userId: string, model: string): string[] {
  const modelMap = userMap.get(userId);
  if (!modelMap) return [];
  const entries = modelMap.get(model);
  if (!entries) return [];
  const now = Date.now();
  return entries.filter(e => now - e.lastUsedAt < USER_TTL_MS).map(e => e.offeringId);
}

export function pushUserAffinity(userId: string, model: string, offeringId: string, latencyMs: number): void {
  if (!userMap.has(userId)) userMap.set(userId, new Map());
  const modelMap = userMap.get(userId)!;
  if (!modelMap.has(model)) modelMap.set(model, []);
  const entries = modelMap.get(model)!;

  const existing = entries.find(e => e.offeringId === offeringId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    existing.avgLatencyMs = Math.round(existing.avgLatencyMs * 0.7 + latencyMs * 0.3);
    return;
  }

  entries.unshift({ offeringId, lastUsedAt: Date.now(), avgLatencyMs: latencyMs });
  if (entries.length > MAX_RECENT) entries.pop();
}

// ── Affinity threshold (dynamic based on conversation length) ──────

export function getAffinityThresholdMs(messageCount: number): number {
  if (messageCount >= 10) return 4000;
  if (messageCount >= 3) return 3000;
  return 2000;
}

// ── Pruner ──────────────────────────────────────────────────────────

let prunerTimer: ReturnType<typeof setInterval> | null = null;

export function startAffinityPruner(): void {
  if (prunerTimer) return;
  prunerTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of convMap) {
      if (now - entry.lastRequestAt > CONV_TTL_MS) convMap.delete(id);
    }
    for (const [userId, modelMap] of userMap) {
      for (const [model, entries] of modelMap) {
        const valid = entries.filter(e => now - e.lastUsedAt < USER_TTL_MS);
        if (valid.length === 0) modelMap.delete(model);
        else modelMap.set(model, valid);
      }
      if (modelMap.size === 0) userMap.delete(userId);
    }
  }, 5 * 60 * 1000);
}

export function stopAffinityPruner(): void {
  if (prunerTimer) { clearInterval(prunerTimer); prunerTimer = null; }
}

// ── Test helpers ────────────────────────────────────────────────────

export function _resetForTest(): void {
  convMap.clear();
  userMap.clear();
}
