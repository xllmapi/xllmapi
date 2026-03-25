#!/usr/bin/env node

import { createServer } from "node:http";

const json = (statusCode, body) => {
  const payload = JSON.stringify(body);
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload).toString(),
    },
    payload,
  };
};

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const inferReply = (messages = []) => {
  const prompt = messages
    .map((message) => String(message?.content ?? ""))
    .join("\n");

  const exactMatch = prompt.match(/exactly:\s*([A-Z0-9_!\-]+)/i);
  if (exactMatch?.[1]) {
    return exactMatch[1];
  }

  if (/say hello/i.test(prompt)) {
    return "hello";
  }

  if (/ping/i.test(prompt)) {
    return "pong";
  }

  return "MOCK_OK";
};

export async function startMockOpenAIProvider(params = {}) {
  const port = Number(params.port ?? 4311);
  const models = params.models ?? [
    "gpt-4o-mini",
    "gpt-4o",
    "deepseek-chat",
    "deepseek-reasoner",
    "claude-sonnet-4-20250514",
    "moonshot-v1-8k",
    "moonshot-v1-32k",
    "kimi-for-coding",
    "MiniMax-M2.7",
  ];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/v1/healthz")) {
      const response = json(200, { ok: true, service: "mock-openai-provider" });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "GET" && (url.pathname === "/models" || url.pathname === "/v1/models")) {
      const response = json(200, {
        object: "list",
        data: models.map((id) => ({ id, object: "model" })),
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    if (req.method === "POST" && (url.pathname === "/chat/completions" || url.pathname === "/v1/chat/completions")) {
      const body = await readJson(req);
      const reply = inferReply(body.messages ?? []);
      const usage = {
        prompt_tokens: 12,
        completion_tokens: Math.max(1, Math.ceil(reply.length / 4)),
        total_tokens: 12 + Math.max(1, Math.ceil(reply.length / 4)),
      };

      if (body.stream === true) {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({
          id: "mock_stream_chunk_1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: reply }, finish_reason: null }],
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id: "mock_stream_chunk_2",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage,
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const response = json(200, {
        id: "mock_completion",
        object: "chat.completion",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: reply,
          },
          finish_reason: "stop",
        }],
        usage,
      });
      res.writeHead(response.statusCode, response.headers);
      res.end(response.payload);
      return;
    }

    const response = json(404, { error: { message: "not found" } });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.payload);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(undefined));
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve(undefined));
      });
    },
  };
}
