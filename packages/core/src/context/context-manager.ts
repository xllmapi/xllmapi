// Context window limits per model family (tokens)
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "deepseek": 128_000,
  "minimax": 200000,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "claude": 200000,
  "kimi-for-coding": 262_144,
  "kimi": 128_000,
  "moonshot-v1-8k": 8_000,
  "moonshot-v1-32k": 32_000,
  "moonshot-v1-128k": 128_000,
  "moonshot": 128_000,
};

const DEFAULT_CONTEXT_LIMIT = 64000;

export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // CJK Unified Ideographs, CJK extensions, fullwidth forms
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFF00 && code <= 0xFFEF)) {
      tokens += 1.5; // CJK character ≈ 1-2 tokens
    } else {
      tokens += 0.3; // ASCII/Latin ≈ 3-4 chars per token
    }
  }
  return Math.ceil(tokens);
}

export function getContextLimit(model: string): number {
  const lower = model.toLowerCase();
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (lower.includes(key)) return limit;
  }
  return DEFAULT_CONTEXT_LIMIT;
}

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

/** Trim messages to fit within 80% of model's context window, keeping most recent */
export function trimToContextWindow(messages: ChatMsg[], model: string): ChatMsg[] {
  const maxTokens = Math.floor(getContextLimit(model) * 0.8);

  // Always keep the last message (current user input)
  if (messages.length <= 1) return messages;

  const lastMsg = messages[messages.length - 1]!;
  let usedTokens = estimateTokens(lastMsg.content);

  // Separate system messages (always keep)
  const systemMsgs = messages.filter((m): m is ChatMsg => m.role === "system");
  const nonSystem = messages.filter((m): m is ChatMsg => m.role !== "system");

  for (const sm of systemMsgs) {
    usedTokens += estimateTokens(sm.content);
  }

  // Take from most recent backwards (excluding the last which is current input)
  const kept: ChatMsg[] = [];
  for (let i = nonSystem.length - 2; i >= 0; i--) {
    const msg = nonSystem[i]!;
    const tokens = estimateTokens(msg.content);
    if (usedTokens + tokens > maxTokens) break;
    usedTokens += tokens;
    kept.unshift(msg);
  }

  // Ensure at least 2 recent exchanges (4 messages) if possible
  if (kept.length < 4 && nonSystem.length > 5) {
    const minKeep = nonSystem.slice(Math.max(nonSystem.length - 5, 0), nonSystem.length - 1);
    if (minKeep.length > kept.length) {
      return [...systemMsgs, ...minKeep, lastMsg];
    }
  }

  return [...systemMsgs, ...kept, lastMsg];
}
