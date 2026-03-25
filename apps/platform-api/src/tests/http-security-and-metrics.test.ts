import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { AppError } from "../lib/errors.js";
import { read_json } from "../lib/http.js";
import { applySecurityHeaders } from "../middleware/security.js";
import { metricsService } from "../metrics.js";

class MockResponse {
  headers = new Map<string, string>();

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }
}

test("read_json rejects oversized request bodies", async () => {
  const req = Readable.from([JSON.stringify({ value: "x".repeat(32) })]) as any;

  await assert.rejects(
    () => read_json(req, { maxBytes: 8 }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 413 &&
      error.code === "payload_too_large"
  );
});

test("read_json rejects invalid json payloads", async () => {
  const req = Readable.from(["{not-json"]) as any;

  await assert.rejects(
    () => read_json(req),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      error.code === "invalid_json"
  );
});

test("security middleware sets baseline security headers", () => {
  const req = {
    headers: {
      origin: "http://localhost:5173"
    }
  } as any;
  const res = new MockResponse();

  applySecurityHeaders(req, res as any);

  assert.equal(res.getHeader("x-content-type-options"), "nosniff");
  assert.equal(res.getHeader("x-frame-options"), "DENY");
  assert.match(String(res.getHeader("content-security-policy")), /default-src 'self'/);
  assert.equal(res.getHeader("access-control-allow-origin"), "http://localhost:5173");
});

test("metrics are rendered in prometheus format", () => {
  metricsService.increment("totalRequests");
  metricsService.increment("settlementFailures");
  const rendered = metricsService.renderPrometheus({ env: "test", release_id: "unit" });

  assert.match(rendered, /# HELP xllmapi_total_requests/);
  assert.match(rendered, /xllmapi_total_requests\{env="test",release_id="unit"\} \d+/);
  assert.match(rendered, /xllmapi_auth_rate_limit_hits/);
  assert.match(rendered, /xllmapi_settlement_failures\{env="test",release_id="unit"\} \d+/);
});
