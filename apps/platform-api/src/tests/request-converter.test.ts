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

// ── Thinking field preservation ──

test("openai→anthropic: thinking field preserved when present", () => {
  const body = {
    model: "kimi-for-coding",
    messages: [{ role: "user", content: "Hi" }],
    thinking: { type: "enabled", budget_tokens: 2048 },
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;
  assert.deepEqual(result.thinking, { type: "enabled", budget_tokens: 2048 });
});

test("anthropic→openai: thinking field preserved when present", () => {
  const body = {
    model: "kimi-for-coding",
    messages: [{ role: "user", content: "Hi" }],
    thinking: { type: "enabled", budget_tokens: 1024 },
  };

  const result = convertRequestBody("anthropic", "openai", body) as any;
  assert.deepEqual(result.thinking, { type: "enabled", budget_tokens: 1024 });
});

test("thinking field not included when absent", () => {
  const body = {
    model: "test",
    messages: [{ role: "user", content: "Hi" }],
  };

  const oaiToAnth = convertRequestBody("openai", "anthropic", body) as any;
  assert.ok(!("thinking" in oaiToAnth));

  const anthToOai = convertRequestBody("anthropic", "openai", body) as any;
  assert.ok(!("thinking" in anthToOai));
});

// ── Tools conversion ──

test("openai→anthropic: tools array converted (function → input_schema)", () => {
  const body = {
    model: "gpt-4",
    messages: [{ role: "user", content: "weather?" }],
    tools: [{
      type: "function",
      function: { name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } } } },
    }],
    tool_choice: "auto",
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].name, "get_weather");
  assert.ok(result.tools[0].input_schema, "should have input_schema");
  assert.equal(result.tools[0].input_schema.type, "object");
  assert.deepEqual(result.tool_choice, { type: "auto" });
});

test("anthropic→openai: tools array converted (input_schema → function)", () => {
  const body = {
    model: "claude-3",
    messages: [{ role: "user", content: "weather?" }],
    tools: [{
      name: "get_weather",
      description: "Get weather",
      input_schema: { type: "object", properties: { city: { type: "string" } } },
    }],
    tool_choice: { type: "auto" },
  };

  const result = convertRequestBody("anthropic", "openai", body) as any;
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].type, "function");
  assert.equal(result.tools[0].function.name, "get_weather");
  assert.ok(result.tools[0].function.parameters);
  assert.equal(result.tool_choice, "auto");
});

test("openai→anthropic: tool message → tool_result user message", () => {
  const body = {
    model: "gpt-4",
    messages: [
      { role: "user", content: "weather?" },
      { role: "assistant", content: "Let me check." },
      { role: "tool", content: "Sunny, 25°C", tool_call_id: "call_123" },
    ],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;
  // tool message should become user message with tool_result content
  const toolMsg = result.messages[2];
  assert.equal(toolMsg.role, "user");
  assert.equal(toolMsg.content[0].type, "tool_result");
  assert.equal(toolMsg.content[0].tool_use_id, "call_123");
  assert.equal(toolMsg.content[0].content, "Sunny, 25°C");
});

test("anthropic→openai: tool_use content blocks → tool_calls on assistant", () => {
  const body = {
    model: "claude-3",
    messages: [{
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Tokyo" } },
      ],
    }],
  };

  const result = convertRequestBody("anthropic", "openai", body) as any;
  const msg = result.messages[0];
  assert.equal(msg.role, "assistant");
  assert.ok(msg.tool_calls, "should have tool_calls");
  assert.equal(msg.tool_calls[0].function.name, "get_weather");
  assert.equal(JSON.parse(msg.tool_calls[0].function.arguments).city, "Tokyo");
});

test("anthropic→openai: tool_result content block → tool role message", () => {
  const body = {
    model: "claude-3",
    messages: [{
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "Sunny, 25°C" },
      ],
    }],
  };

  const result = convertRequestBody("anthropic", "openai", body) as any;
  const msg = result.messages[0];
  assert.equal(msg.role, "tool");
  assert.equal(msg.tool_call_id, "toolu_1");
  assert.equal(msg.content, "Sunny, 25°C");
});

// ── Image conversion ──

test("openai→anthropic: image_url data URI → Anthropic base64 image", () => {
  const body = {
    model: "gpt-4o",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      ],
    }],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;
  const imgBlock = result.messages[0].content[1];
  assert.equal(imgBlock.type, "image");
  assert.equal(imgBlock.source.type, "base64");
  assert.equal(imgBlock.source.media_type, "image/png");
  assert.equal(imgBlock.source.data, "iVBORw0KGgo=");
});

test("openai→anthropic: image_url regular URL → Anthropic url image", () => {
  const body = {
    model: "gpt-4o",
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "https://example.com/photo.jpg" } },
      ],
    }],
  };

  const result = convertRequestBody("openai", "anthropic", body) as any;
  const imgBlock = result.messages[0].content[0];
  assert.equal(imgBlock.type, "image");
  assert.equal(imgBlock.source.type, "url");
  assert.equal(imgBlock.source.url, "https://example.com/photo.jpg");
});

// ── Additional parameter preservation ──

test("anthropic→openai: preserves presence_penalty, frequency_penalty, seed, response_format", () => {
  const body = {
    model: "claude-3",
    messages: [{ role: "user", content: "Hi" }],
    presence_penalty: 0.5,
    frequency_penalty: 0.3,
    seed: 42,
    response_format: { type: "json_object" },
  };

  const result = convertRequestBody("anthropic", "openai", body) as any;
  assert.equal(result.presence_penalty, 0.5);
  assert.equal(result.frequency_penalty, 0.3);
  assert.equal(result.seed, 42);
  assert.deepEqual(result.response_format, { type: "json_object" });
});
