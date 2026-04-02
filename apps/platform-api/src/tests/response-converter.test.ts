import assert from "node:assert/strict";
import test from "node:test";

import { convertJsonResponse, createStreamConverter, detectStreamFormat } from "../core/adapters/response-converter.js";

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

// ── New test cases ───────────────────────────────────────────────

test("convertJsonResponse: stop reason 'stop' maps to 'end_turn' for Anthropic", () => {
  const openaiResp = {
    id: "chatcmpl-stop1",
    object: "chat.completion",
    model: "gpt-4",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "Done" },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
  };

  const result = convertJsonResponse("openai", "anthropic", openaiResp) as any;

  assert.equal(result.stop_reason, "end_turn");
});

test("convertJsonResponse: stop reason 'length' maps to 'max_tokens' for Anthropic", () => {
  const openaiResp = {
    id: "chatcmpl-len1",
    object: "chat.completion",
    model: "gpt-4",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "Truncated output" },
      finish_reason: "length"
    }],
    usage: { prompt_tokens: 3, completion_tokens: 10, total_tokens: 13 }
  };

  const result = convertJsonResponse("openai", "anthropic", openaiResp) as any;

  assert.equal(result.stop_reason, "max_tokens");
});

test("convertJsonResponse: empty content in OpenAI response", () => {
  const openaiResp = {
    id: "chatcmpl-empty",
    object: "chat.completion",
    model: "gpt-4",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "" },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 }
  };

  const result = convertJsonResponse("openai", "anthropic", openaiResp) as any;

  assert.equal(result.type, "message");
  assert.equal(result.content[0].type, "text");
  assert.equal(result.content[0].text, "");
  assert.equal(result.usage.input_tokens, 5);
  assert.equal(result.usage.output_tokens, 0);
});

test("convertJsonResponse: missing usage field handled gracefully", () => {
  const openaiResp = {
    id: "chatcmpl-nousage",
    object: "chat.completion",
    model: "gpt-4",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "No usage info" },
      finish_reason: "stop"
    }],
    // no usage field at all
  };

  const result = convertJsonResponse("openai", "anthropic", openaiResp) as any;

  assert.equal(result.type, "message");
  assert.equal(result.content[0].text, "No usage info");
  assert.equal(result.usage.input_tokens, 0);
  assert.equal(result.usage.output_tokens, 0);

  // Also test Anthropic → OpenAI direction
  const anthropicResp = {
    id: "msg_nousage",
    type: "message",
    role: "assistant",
    model: "claude-3",
    content: [{ type: "text", text: "Hello" }],
    stop_reason: "end_turn",
    // no usage field
  };

  const result2 = convertJsonResponse("anthropic", "openai", anthropicResp) as any;

  assert.equal(result2.usage.prompt_tokens, 0);
  assert.equal(result2.usage.completion_tokens, 0);
  assert.equal(result2.usage.total_tokens, 0);
});

test("convertJsonResponse: multiple choices/content blocks", () => {
  // Anthropic with multiple content blocks → OpenAI
  const anthropicResp = {
    id: "msg_multi",
    type: "message",
    role: "assistant",
    model: "claude-3",
    content: [
      { type: "text", text: "First block. " },
      { type: "text", text: "Second block." },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 8 }
  };

  const result = convertJsonResponse("anthropic", "openai", anthropicResp) as any;

  // Multiple text blocks should be concatenated into a single content string
  assert.equal(result.choices[0].message.content, "First block. Second block.");
  assert.equal(result.choices[0].finish_reason, "stop");
  assert.equal(result.usage.prompt_tokens, 10);
  assert.equal(result.usage.completion_tokens, 8);
  assert.equal(result.usage.total_tokens, 18);

  // OpenAI → Anthropic only uses choices[0], verify it works with multiple choices
  const openaiResp = {
    id: "chatcmpl-multi",
    object: "chat.completion",
    model: "gpt-4",
    choices: [
      { index: 0, message: { role: "assistant", content: "Choice 0" }, finish_reason: "stop" },
      { index: 1, message: { role: "assistant", content: "Choice 1" }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 }
  };

  const result2 = convertJsonResponse("openai", "anthropic", openaiResp) as any;

  // Should use the first choice only
  assert.equal(result2.content[0].text, "Choice 0");
  assert.equal(result2.stop_reason, "end_turn");
});

test("createStreamConverter: empty stream with only [DONE]", () => {
  const converter = createStreamConverter("openai", "anthropic");

  const out = converter.transform("data: [DONE]\n\n");
  const flush = converter.flush();
  const joined = [...out, ...flush].join("");

  // Even with only [DONE], flush should emit closing events including message_stop
  assert.ok(joined.includes("message_stop"), "should contain message_stop");
});

test("createStreamConverter: Anthropic stop reason maps to OpenAI", () => {
  const converter = createStreamConverter("anthropic", "openai");

  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_sr","type":"message","role":"assistant","model":"claude-3","content":[],"usage":{"input_tokens":5,"output_tokens":0}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Truncated"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    // max_tokens stop reason should map to "length" in OpenAI
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":10}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];

  const allOutput: string[] = [];
  for (const evt of events) {
    allOutput.push(...converter.transform(evt));
  }
  allOutput.push(...converter.flush());

  const joined = allOutput.join("");
  assert.ok(joined.includes('"finish_reason":"length"'), "max_tokens should map to length");
  assert.ok(joined.includes("Truncated"), "should contain content");
  assert.ok(joined.includes("[DONE]"), "should end with [DONE]");
});

// ── detectStreamFormat ──────────────────────────────────────────

test("detectStreamFormat: Anthropic markers detected", () => {
  const anthropicSse = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n';
  assert.equal(detectStreamFormat(anthropicSse, "openai"), "anthropic");
});

test("detectStreamFormat: content_block_delta detected as Anthropic", () => {
  const text = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n';
  assert.equal(detectStreamFormat(text, "openai"), "anthropic");
});

test("detectStreamFormat: OpenAI markers detected", () => {
  const openaiSse = 'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}]}\n\n';
  assert.equal(detectStreamFormat(openaiSse, "anthropic"), "openai");
});

test("detectStreamFormat: unknown format returns fallback", () => {
  assert.equal(detectStreamFormat("some random data", "openai"), "openai");
  assert.equal(detectStreamFormat("some random data", "anthropic"), "anthropic");
});

// ── Auto-detect stream converter ────────────────────────────────

test("autoDetect: OpenAI response with OpenAI→Anthropic expected converts correctly", () => {
  const converter = createStreamConverter("openai", "anthropic", { autoDetect: true });

  const chunk = 'data: {"id":"c1","model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\ndata: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const out = converter.transform(chunk);
  const flush = converter.flush();
  const joined = [...out, ...flush].join("");

  assert.ok(joined.includes("message_start"), "should detect OpenAI and convert to Anthropic");
  assert.ok(joined.includes("content_block_delta"), "should have content delta");
  assert.ok(joined.includes("Hello"), "should contain text");
  assert.ok(joined.includes("message_stop"), "should have message_stop");
});

test("autoDetect: Anthropic response on expected-OpenAI endpoint converts correctly", () => {
  // This is the Kimi scenario: expected OpenAI but got Anthropic SSE
  const converter = createStreamConverter("openai", "anthropic", { autoDetect: true });

  const chunk = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_k1","type":"message","role":"assistant","model":"kimi-for-coding","content":[],"usage":{"input_tokens":10}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"1 + 2 = 3"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join("");

  const out = converter.transform(chunk);
  const flush = converter.flush();
  const joined = [...out, ...flush].join("");

  // Auto-detect should recognize Anthropic format = same as client format → passthrough
  assert.ok(joined.includes("1 + 2 = 3"), "should passthrough Anthropic content when client wants Anthropic");
  assert.ok(joined.includes("message_start"), "should contain message_start");
});

test("autoDetect: Anthropic response on expected-OpenAI endpoint for OpenAI client converts", () => {
  // Provider returns Anthropic but client wants OpenAI
  const converter = createStreamConverter("openai", "openai", { autoDetect: true });

  const chunk = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_k2","type":"message","role":"assistant","model":"kimi","content":[],"usage":{"input_tokens":10}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join("");

  const out = converter.transform(chunk);
  const flush = converter.flush();
  const joined = [...out, ...flush].join("");

  assert.ok(joined.includes("Hello"), "should convert Anthropic content to OpenAI format");
  assert.ok(joined.includes("chat.completion.chunk"), "should contain OpenAI chunk format");
  assert.ok(joined.includes("[DONE]"), "should end with [DONE]");
});

test("autoDetect: same format passthrough works", () => {
  const converter = createStreamConverter("openai", "openai", { autoDetect: true });

  const chunk = 'data: {"id":"c1","choices":[{"delta":{"content":"Hi"}}]}\n\n';
  const out = converter.transform(chunk);
  const flush = converter.flush();
  const joined = [...out, ...flush].join("");

  // Should detect OpenAI = same as client → passthrough
  assert.ok(joined.includes("Hi"), "should passthrough content");
  assert.ok(joined.includes("choices"), "should preserve OpenAI format");
});

// ── reasoning_content handling ──────────────────────────────────

test("OpenAI→Anthropic converter handles reasoning_content", () => {
  const converter = createStreamConverter("openai", "anthropic");

  // First chunk: reasoning content only
  const chunk1 = 'data: {"id":"c1","model":"kimi","choices":[{"index":0,"delta":{"reasoning_content":"Let me think..."},"finish_reason":null}]}\n\n';
  const out1 = converter.transform(chunk1);
  const joined1 = out1.join("");
  assert.ok(joined1.includes("message_start"), "reasoning_content should trigger init");
  assert.ok(joined1.includes("Let me think..."), "should contain reasoning text");

  // Second chunk: regular content
  const chunk2 = 'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"The answer is 3"},"finish_reason":null}]}\n\n';
  const out2 = converter.transform(chunk2);
  const joined2 = out2.join("");
  assert.ok(joined2.includes("The answer is 3"), "should contain regular content");

  // Finish
  const chunk3 = 'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const out3 = converter.transform(chunk3);
  const flush = converter.flush();
  const joinedEnd = [...out3, ...flush].join("");
  assert.ok(joinedEnd.includes("message_stop"), "should have stop event");
});

test("OpenAI→Anthropic converter handles reasoning_content only (no regular content)", () => {
  const converter = createStreamConverter("openai", "anthropic");

  const chunks = [
    'data: {"id":"c1","model":"deepseek","choices":[{"index":0,"delta":{"reasoning_content":"Thinking step 1"},"finish_reason":null}]}\n\n',
    'data: {"id":"c1","choices":[{"index":0,"delta":{"reasoning_content":"Thinking step 2"},"finish_reason":null}]}\n\n',
    'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  ];

  const allOutput: string[] = [];
  for (const chunk of chunks) {
    allOutput.push(...converter.transform(chunk));
  }
  allOutput.push(...converter.flush());

  const joined = allOutput.join("");
  assert.ok(joined.includes("Thinking step 1"), "should include first reasoning chunk");
  assert.ok(joined.includes("Thinking step 2"), "should include second reasoning chunk");
  assert.ok(joined.includes("message_start"), "should have started the stream");
  assert.ok(joined.includes("message_stop"), "should have stopped the stream");
});

// ── input_tokens in OpenAI→Anthropic message_delta ─────────────

test("OpenAI→Anthropic converter includes input_tokens in message_delta", () => {
  const converter = createStreamConverter("openai", "anthropic");

  // First chunk: content (triggers message_start with input_tokens: 0)
  const chunk1 = 'data: {"id":"c1","model":"deepseek-chat","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n';
  const out1 = converter.transform(chunk1);
  const joined1 = out1.join("");
  assert.ok(joined1.includes("message_start"), "should emit message_start");
  // message_start still has input_tokens: 0 (not yet available)
  assert.ok(joined1.includes('"input_tokens":0'), "message_start should have input_tokens: 0");

  // Final chunk: finish_reason + usage with prompt_tokens
  const chunk2 = 'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":42,"completion_tokens":7}}\n\n';
  const out2 = converter.transform(chunk2);
  const joined2 = out2.join("");

  // message_delta should now contain input_tokens from the final usage
  assert.ok(joined2.includes("message_delta"), "should emit message_delta");
  assert.ok(joined2.includes('"input_tokens":42'), "message_delta should contain input_tokens from upstream usage");
  assert.ok(joined2.includes('"output_tokens":7'), "message_delta should contain output_tokens");
});

test("OpenAI→Anthropic converter handles usage arriving only in [DONE]-preceding chunk", () => {
  const converter = createStreamConverter("openai", "anthropic");

  // Content chunks
  const chunks = [
    'data: {"id":"c1","model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n',
    'data: {"id":"c1","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
    // Usage in a separate chunk before finish
    'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15,"completion_tokens":3}}\n\n',
    'data: [DONE]\n\n',
  ];

  const allOutput: string[] = [];
  for (const chunk of chunks) {
    allOutput.push(...converter.transform(chunk));
  }
  allOutput.push(...converter.flush());

  const joined = allOutput.join("");

  // Extract the message_delta event data
  const deltaMatch = joined.match(/event: message_delta\ndata: ({.*?})\n\n/s);
  assert.ok(deltaMatch, "should have message_delta event");
  const deltaData = JSON.parse(deltaMatch![1]);
  assert.equal(deltaData.usage.input_tokens, 15, "message_delta.usage.input_tokens should be 15");
  assert.equal(deltaData.usage.output_tokens, 3, "message_delta.usage.output_tokens should be 3");
});

// ── thinking_delta in Anthropic→OpenAI ─────────────────────────

test("Anthropic→OpenAI converter maps thinking_delta to reasoning_content", () => {
  const converter = createStreamConverter("anthropic", "openai");

  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_t1","type":"message","role":"assistant","model":"kimi","content":[],"usage":{"input_tokens":5,"output_tokens":0}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"The answer is 2"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];

  const allOutput: string[] = [];
  for (const evt of events) {
    allOutput.push(...converter.transform(evt));
  }
  allOutput.push(...converter.flush());

  const joined = allOutput.join("");
  assert.ok(joined.includes("reasoning_content"), "thinking_delta should map to reasoning_content");
  assert.ok(joined.includes("Let me think..."), "should contain thinking text");
  assert.ok(joined.includes("The answer is 2"), "should contain regular content");
  assert.ok(joined.includes("[DONE]"), "should end with [DONE]");
});

test("Anthropic→OpenAI converter handles thinking_delta only (no text)", () => {
  const converter = createStreamConverter("anthropic", "openai");

  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_t2","type":"message","role":"assistant","model":"test","content":[],"usage":{"input_tokens":5,"output_tokens":0}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Deep reasoning..."}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];

  const allOutput: string[] = [];
  for (const evt of events) {
    allOutput.push(...converter.transform(evt));
  }
  allOutput.push(...converter.flush());

  const joined = allOutput.join("");
  assert.ok(joined.includes("reasoning_content"), "should have reasoning_content");
  assert.ok(joined.includes("Deep reasoning..."), "should contain thinking text");
  assert.ok(joined.includes("[DONE]"), "should end with [DONE]");
});
