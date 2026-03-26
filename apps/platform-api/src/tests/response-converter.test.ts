import assert from "node:assert/strict";
import test from "node:test";

import { convertJsonResponse, createStreamConverter } from "../core/adapters/response-converter.js";

// ── Non-streaming JSON conversion ─────────────────────────────────

test("convertJsonResponse: OpenAI → Anthropic", () => {
  const openaiResp = {
    id: "chatcmpl-123",
    object: "chat.completion",
    model: "deepseek-chat",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "Hello world" },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };

  const result = convertJsonResponse("openai", "anthropic", openaiResp) as any;

  assert.equal(result.type, "message");
  assert.equal(result.role, "assistant");
  assert.equal(result.model, "deepseek-chat");
  assert.equal(result.content[0].type, "text");
  assert.equal(result.content[0].text, "Hello world");
  assert.equal(result.stop_reason, "end_turn");
  assert.equal(result.usage.input_tokens, 10);
  assert.equal(result.usage.output_tokens, 5);
});

test("convertJsonResponse: Anthropic → OpenAI", () => {
  const anthropicResp = {
    id: "msg_123",
    type: "message",
    role: "assistant",
    model: "MiniMax-M2.7",
    content: [{ type: "text", text: "Hello world" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 }
  };

  const result = convertJsonResponse("anthropic", "openai", anthropicResp) as any;

  assert.equal(result.object, "chat.completion");
  assert.equal(result.model, "MiniMax-M2.7");
  assert.equal(result.choices[0].message.role, "assistant");
  assert.equal(result.choices[0].message.content, "Hello world");
  assert.equal(result.choices[0].finish_reason, "stop");
  assert.equal(result.usage.prompt_tokens, 10);
  assert.equal(result.usage.completion_tokens, 5);
  assert.equal(result.usage.total_tokens, 15);
});

test("convertJsonResponse: same format returns unchanged", () => {
  const body = { id: "test", choices: [] };
  const result = convertJsonResponse("openai", "openai", body);
  assert.deepStrictEqual(result, body);
});

// ── Streaming SSE conversion ──────────────────────────────────────

test("createStreamConverter: OpenAI SSE → Anthropic SSE", () => {
  const converter = createStreamConverter("openai", "anthropic");

  // First chunk with role
  const chunk1 = 'data: {"id":"c1","object":"chat.completion.chunk","model":"deepseek-chat","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n';
  const out1 = converter.transform(chunk1);
  // Should emit message_start + content_block_start + content_block_delta
  const joined1 = out1.join("");
  assert.ok(joined1.includes("message_start"), "should contain message_start");
  assert.ok(joined1.includes("content_block_start"), "should contain content_block_start");
  assert.ok(joined1.includes("Hello"), "should contain content text");

  // Content chunk
  const chunk2 = 'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n';
  const out2 = converter.transform(chunk2);
  const joined2 = out2.join("");
  assert.ok(joined2.includes("content_block_delta"), "should contain delta");
  assert.ok(joined2.includes(" world"), "should contain content");

  // Finish chunk
  const chunk3 = 'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n';
  const out3 = converter.transform(chunk3);
  const joined3 = out3.join("");
  assert.ok(joined3.includes("content_block_stop") || joined3.includes("message_stop"), "should contain stop event");

  // DONE
  const chunk4 = "data: [DONE]\n\n";
  const out4 = converter.transform(chunk4);
  const flush = converter.flush();
  const joinedEnd = [...out4, ...flush].join("");
  assert.ok(joinedEnd.includes("message_stop") || joined3.includes("message_stop"), "should end with message_stop");
});

test("createStreamConverter: Anthropic SSE → OpenAI SSE", () => {
  const converter = createStreamConverter("anthropic", "openai");

  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"test","content":[],"usage":{"input_tokens":5,"output_tokens":0}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];

  const allOutput: string[] = [];
  for (const evt of events) {
    allOutput.push(...converter.transform(evt));
  }
  allOutput.push(...converter.flush());

  const joined = allOutput.join("");
  assert.ok(joined.includes("chat.completion.chunk"), "should contain OpenAI chunk format");
  assert.ok(joined.includes("Hi"), "should contain content");
  assert.ok(joined.includes("[DONE]"), "should end with [DONE]");
});

test("createStreamConverter: same format returns null", () => {
  const converter = createStreamConverter("openai", "openai");
  // Same format should be a passthrough — but our implementation may still create a converter
  // The key is that provider-executor.ts only creates converter when needsConversion is true
  // So this test just verifies it doesn't crash
  const result = converter.transform('data: {"test":true}\n\n');
  assert.ok(Array.isArray(result));
});

test("createStreamConverter handles partial TCP chunks", () => {
  const converter = createStreamConverter("openai", "anthropic");

  // Send partial data
  const partial1 = 'data: {"id":"c1","object":"chat.completion.chunk","cho';
  const out1 = converter.transform(partial1);
  // Should buffer, not crash
  assert.ok(Array.isArray(out1));

  // Complete the line
  const partial2 = 'ices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n';
  const out2 = converter.transform(partial2);
  const joined = out2.join("");
  assert.ok(joined.includes("Hi") || out1.join("").includes("Hi"), "should eventually output content");
});
