import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  getContextLimit,
  trimToContextWindow,
} from "../context-manager.js";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    assert.equal(estimateTokens(""), 0);
  });

  it('returns 2 for "hello"', () => {
    assert.equal(estimateTokens("hello"), Math.ceil(5 * 0.3));
  });

  it("scales proportionally with longer ASCII text", () => {
    const text = "a".repeat(100);
    // 100 ASCII chars at ~0.3 per char ≈ 30 tokens (floating point may round up to 31)
    const result = estimateTokens(text);
    assert.ok(result >= 30 && result <= 31, `expected 30-31, got ${result}`);
  });

  it("estimates CJK characters at higher rate", () => {
    const text = "你好世界"; // 4 CJK characters
    assert.equal(estimateTokens(text), Math.ceil(4 * 1.5));
  });

  it("handles mixed CJK and ASCII", () => {
    const text = "hello你好"; // 5 ASCII + 2 CJK
    assert.equal(estimateTokens(text), Math.ceil(5 * 0.3 + 2 * 1.5));
  });
});

describe("getContextLimit", () => {
  it('returns 128000 for "deepseek-chat"', () => {
    assert.equal(getContextLimit("deepseek-chat"), 128000);
  });

  it('returns 200000 for "claude-3-sonnet"', () => {
    assert.equal(getContextLimit("claude-3-sonnet"), 200000);
  });

  it("returns 64000 for unknown model", () => {
    assert.equal(getContextLimit("unknown-model"), 64000);
  });

  it("is case insensitive", () => {
    assert.equal(getContextLimit("DeepSeek-Chat"), 128000);
  });

  it('returns 8000 for "moonshot-v1-8k"', () => {
    assert.equal(getContextLimit("moonshot-v1-8k"), 8000);
  });
});

describe("trimToContextWindow", () => {
  it("returns empty array unchanged", () => {
    const result = trimToContextWindow([], "deepseek-chat");
    assert.deepEqual(result, []);
  });

  it("returns single message as-is", () => {
    const msgs: ChatMsg[] = [{ role: "user", content: "hi" }];
    const result = trimToContextWindow(msgs, "deepseek-chat");
    assert.deepEqual(result, msgs);
  });

  it("does not trim short conversations", () => {
    const msgs: ChatMsg[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "how are you?" },
    ];
    const result = trimToContextWindow(msgs, "deepseek-chat");
    assert.deepEqual(result, msgs);
  });

  it("always preserves system messages", () => {
    const msgs: ChatMsg[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "bye" },
    ];
    const result = trimToContextWindow(msgs, "deepseek-chat");
    const systemMsgs = result.filter((m) => m.role === "system");
    assert.equal(systemMsgs.length, 1);
    assert.equal(systemMsgs[0]!.content, "You are helpful.");
  });

  it("always keeps last message", () => {
    const lastMsg: ChatMsg = { role: "user", content: "final question" };
    const msgs: ChatMsg[] = [
      { role: "user", content: "a".repeat(10000) },
      { role: "assistant", content: "b".repeat(10000) },
      lastMsg,
    ];
    const result = trimToContextWindow(msgs, "moonshot-v1-8k");
    assert.equal(result[result.length - 1]!.content, "final question");
  });

  it("trims oldest messages first when exceeding context window", () => {
    // moonshot-v1-8k has 8000 token limit, 80% = 6400 tokens
    // Each message ~2857 tokens (10000 chars / 3.5)
    const msgs: ChatMsg[] = [
      { role: "user", content: "a".repeat(10000) },
      { role: "assistant", content: "b".repeat(10000) },
      { role: "user", content: "c".repeat(10000) },
      { role: "assistant", content: "d".repeat(10000) },
      { role: "user", content: "e".repeat(10000) },
      { role: "assistant", content: "f".repeat(10000) },
      { role: "user", content: "current" },
    ];
    const result = trimToContextWindow(msgs, "moonshot-v1-8k");
    // The result should be shorter than the input
    assert.ok(result.length < msgs.length);
    // Last message preserved
    assert.equal(result[result.length - 1]!.content, "current");
  });

  it("applies minimum guarantee of 5 recent non-system messages when kept < 4 and nonSystem > 5", () => {
    // Use a small context window so normal trimming keeps < 4
    // moonshot-v1-8k: 8000 * 0.8 = 6400 tokens
    // Make messages large enough that only ~1 fits normally
    const msgs: ChatMsg[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a".repeat(8000) },   // ~2286 tokens
      { role: "assistant", content: "b".repeat(8000) },
      { role: "user", content: "c".repeat(8000) },
      { role: "assistant", content: "d".repeat(8000) },
      { role: "user", content: "e".repeat(8000) },
      { role: "assistant", content: "f".repeat(8000) },
      { role: "user", content: "current" },
    ];
    const result = trimToContextWindow(msgs, "moonshot-v1-8k");
    // nonSystem = 7, so > 5; kept would be < 4 due to token limit
    // minimum guarantee: 5 most recent non-system + last + system
    const nonSystemResult = result.filter((m) => m.role !== "system");
    assert.ok(nonSystemResult.length >= 5, `expected at least 5 non-system messages, got ${nonSystemResult.length}`);
    // System message preserved
    assert.equal(result[0]!.role, "system");
  });
});
