import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../../..");
const randomPort = () => 3400 + Math.floor(Math.random() * 1000);

const startServer = async () => {
  const port = randomPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "apps/platform-api/src/main.ts"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), XLLMAPI_ENV: "development" },
    stdio: "pipe",
  });

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${baseUrl}/healthz`);
      if (r.ok) return { baseUrl, stop: () => { child.kill("SIGTERM"); } };
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500));
  }
  child.kill("SIGTERM");
  throw new Error("Server did not start");
};

test("/v1/models returns OpenAI-compatible format by default", async () => {
  const server = await startServer();
  try {
    const resp = await fetch(`${server.baseUrl}/v1/models`);
    assert.equal(resp.status, 200);
    const body = await resp.json() as any;

    assert.equal(body.object, "list");
    assert.ok(Array.isArray(body.data));

    if (body.data.length > 0) {
      const model = body.data[0];
      assert.ok(model.id, "model should have id field");
      assert.equal(model.object, "model");
      assert.ok(typeof model.created === "number", "created should be a number");
      assert.equal(model.owned_by, "xllmapi");
    }
  } finally {
    server.stop();
  }
});

test("/v1/models returns Anthropic format when anthropic-version header present", async () => {
  const server = await startServer();
  try {
    const resp = await fetch(`${server.baseUrl}/v1/models`, {
      headers: { "anthropic-version": "2023-06-01" }
    });
    assert.equal(resp.status, 200);
    const body = await resp.json() as any;

    assert.ok(Array.isArray(body.data));
    assert.equal(typeof body.has_more, "boolean");

    if (body.data.length > 0) {
      const model = body.data[0];
      assert.ok(model.id, "model should have id field");
      assert.equal(model.type, "model");
      assert.ok(model.display_name, "model should have display_name");
      assert.ok(model.created_at, "model should have created_at");
    }
  } finally {
    server.stop();
  }
});

test("/models short route works same as /v1/models", async () => {
  const server = await startServer();
  try {
    const resp = await fetch(`${server.baseUrl}/models`);
    assert.equal(resp.status, 200);
    const body = await resp.json() as any;

    assert.equal(body.object, "list");
    assert.ok(Array.isArray(body.data));
  } finally {
    server.stop();
  }
});

test("/v1/network/models returns xllmapi marketplace format", async () => {
  const server = await startServer();
  try {
    const resp = await fetch(`${server.baseUrl}/v1/network/models`, {
      headers: { "x-api-key": "xllm_admin_key_local" }
    });
    assert.equal(resp.status, 200);
    const body = await resp.json() as any;

    assert.equal(body.object, "list");
    assert.ok(Array.isArray(body.data));

    if (body.data.length > 0) {
      const model = body.data[0];
      assert.ok(model.logicalModel, "marketplace model should have logicalModel");
      assert.ok(Array.isArray(model.providers), "marketplace model should have providers array");
    }
  } finally {
    server.stop();
  }
});

test("/chat/completions short route responds to POST", async () => {
  const server = await startServer();
  try {
    const resp = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "x-api-key": "xllm_admin_key_local", "content-type": "application/json" },
      body: JSON.stringify({ model: "nonexistent", messages: [{ role: "user", content: "test" }] })
    });
    // Should get 404 (no model) not 404 (route not found)
    const body = await resp.json() as any;
    assert.ok(body.error, "should return an error for nonexistent model");
    assert.notEqual(body.error.message, "Not found", "should NOT be route-level 404");
  } finally {
    server.stop();
  }
});

test("/messages short route responds to POST", async () => {
  const server = await startServer();
  try {
    const resp = await fetch(`${server.baseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": "xllm_admin_key_local", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "nonexistent", max_tokens: 10, messages: [{ role: "user", content: "test" }] })
    });
    const body = await resp.json() as any;
    assert.ok(body.error, "should return an error for nonexistent model");
    assert.notEqual(body.error.message, "Not found", "should NOT be route-level 404");
  } finally {
    server.stop();
  }
});
