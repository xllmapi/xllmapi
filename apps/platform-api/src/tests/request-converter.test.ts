import assert from "node:assert/strict";
import test from "node:test";

import { convertRequestBody } from "../core/adapters/converter.js";

// ── OpenAI → Anthropic ──────────────────────────────────────────────

test("openai→anthropic: system message extracted to top-level system field", () => {
  const body = {
    model: "gpt-4",
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;

  assert.equal(result.system, "You are helpful.");
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[0].content, "Hi");
});

test("openai→anthropic: multi-turn conversation role mapping", () => {
  const body = {
    model: "gpt-4",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "How are you?" },
    ],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;

  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[1].role, "assistant");
  assert.equal(result.messages[2].role, "user");
});

test("openai→anthropic: stop → stop_sequences", () => {
  const body = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hi" }],
    stop: ["\n", "END"],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;

  assert.deepEqual(result.stop_sequences, ["\n", "END"]);
  assert.equal(result.stop, undefined);
});

test("openai→anthropic: max_tokens/temperature/top_p passed through", () => {
  const body = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hi" }],
    max_tokens: 2048,
    temperature: 0.7,
    top_p: 0.9,
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;

  assert.equal(result.max_tokens, 2048);
  assert.equal(result.temperature, 0.7);
  assert.equal(result.top_p, 0.9);
});

test("openai→anthropic: stream parameter preserved", () => {
  const body = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hi" }],
    stream: true,
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;

  assert.equal(result.stream, true);
});

test("openai→anthropic: max_tokens defaults to 4096 when missing", () => {
  const body = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hi" }],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;

  assert.equal(result.max_tokens, 4096);
});

// ── Anthropic → OpenAI ──────────────────────────────────────────────

test("anthropic→openai: system field prepended as system message", () => {
  const body = {
    model: "claude-3-opus",
    system: "You are a poet.",
    messages: [{ role: "user", content: "Write a haiku" }],
  };

  const result = convertRequestBody("anthropic", "openai", body) as any;

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, "system");
  assert.equal(result.messages[0].content, "You are a poet.");
  assert.equal(result.messages[1].role, "user");
  assert.equal(result.messages[1].content, "Write a haiku");
});

test("anthropic→openai: system as array of {text} objects", () => {
  const body = {
    model: "claude-3-opus",
    system: [{ text: "Be concise." }, { text: "Be helpful." }],
    messages: [{ role: "user", content: "Hi" }],
  };

  const result = convertRequestBody("anthropic", "openai", body) as any;

  assert.equal(result.messages[0].role, "system");
  assert.equal(result.messages[0].content, "Be concise.\nBe helpful.");
});

test("anthropic→openai: content blocks (array of {type:'text',text:'...'}) → joined text", () => {
  const body = {
    model: "claude-3-opus",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: "World" },
        ],
      },
    ],
  };

  const result = convertRequestBody("anthropic", "openai", body) as any;

  assert.equal(result.messages[0].content, "Hello\nWorld");
});

test("anthropic→openai: stop_sequences → stop", () => {
  const body = {
    model: "claude-3-opus",
    messages: [{ role: "user", content: "Hi" }],
    stop_sequences: ["STOP", "END"],
  };

  const result = convertRequestBody("anthropic", "openai", body) as any;

  assert.deepEqual(result.stop, ["STOP", "END"]);
  assert.equal(result.stop_sequences, undefined);
});

// ── Same format passthrough ─────────────────────────────────────────

test("same format → body returned unchanged (identity)", () => {
  const body = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hi" }],
    temperature: 0.5,
  };

  const result = convertRequestBody("openai", "openai", body);

  assert.equal(result, body); // exact same reference
});

// ── Edge cases ──────────────────────────────────────────────────────

test("openai→anthropic: empty messages array", () => {
  const body = {
    model: "gpt-4",
    messages: [],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;

  assert.deepEqual(result.messages, []);
  assert.equal(result.system, undefined);
  assert.equal(result.max_tokens, 4096);
});

test("openai→anthropic: no system message in conversation", () => {
  const body = {
    model: "gpt-4",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;

  assert.equal(result.system, undefined);
  assert.equal(result.messages.length, 2);
});

test("openai→anthropic: only system messages", () => {
  const body = {
    model: "gpt-4",
    messages: [
      { role: "system", content: "Instruction one." },
      { role: "system", content: "Instruction two." },
    ],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;

  assert.equal(result.system, "Instruction one.\nInstruction two.");
  assert.deepEqual(result.messages, []);
});

test("undefined optional parameters not included in output", () => {
  const body = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hi" }],
  };

  const oaiToAnth = convertRequestBody("openai", "anthropic", body) as any;

  assert.equal(oaiToAnth.temperature, undefined);
  assert.equal(oaiToAnth.stream, undefined);
  assert.equal(oaiToAnth.top_p, undefined);
  assert.equal(oaiToAnth.stop_sequences, undefined);
  assert.ok(!("temperature" in oaiToAnth));
  assert.ok(!("stream" in oaiToAnth));
  assert.ok(!("top_p" in oaiToAnth));
  assert.ok(!("stop_sequences" in oaiToAnth));

  const anthBody = {
    model: "claude-3-opus",
    messages: [{ role: "user", content: "Hi" }],
  };

  const anthToOai = convertRequestBody("anthropic", "openai", anthBody) as any;

  assert.ok(!("max_tokens" in anthToOai));
  assert.ok(!("temperature" in anthToOai));
  assert.ok(!("stream" in anthToOai));
  assert.ok(!("top_p" in anthToOai));
  assert.ok(!("stop" in anthToOai));
});
