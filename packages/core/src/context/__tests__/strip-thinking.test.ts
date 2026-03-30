import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripThinking } from "../strip-thinking.js";

describe("stripThinking", () => {
  it("returns text unchanged when no think tags present", () => {
    assert.equal(stripThinking("Hello world"), "Hello world");
  });

  it("removes a single <think>...</think> block", () => {
    assert.equal(
      stripThinking("<think>internal reasoning</think>The answer is 42."),
      "The answer is 42."
    );
  });

  it("removes multiple think blocks", () => {
    assert.equal(
      stripThinking(
        "<think>first</think>Hello <think>second</think>world"
      ),
      "Hello world"
    );
  });

  it("removes unclosed <think> at end of string", () => {
    assert.equal(
      stripThinking("The answer is 42.<think>partial streaming content"),
      "The answer is 42."
    );
  });

  it("removes think block in the middle of text", () => {
    assert.equal(
      stripThinking("before<think>middle</think>after"),
      "beforeafter"
    );
  });

  it("handles think blocks with newlines and special characters", () => {
    const input = `<think>
Let me think about this...
- point 1
- point 2
* special & chars < >
</think>Here is the answer.`;
    assert.equal(stripThinking(input), "Here is the answer.");
  });

  it("removes empty think block", () => {
    assert.equal(stripThinking("<think></think>Result"), "Result");
  });
});
