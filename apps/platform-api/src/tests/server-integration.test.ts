import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../../..");

const randomPort = () => 3400 + Math.floor(Math.random() * 1000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForHealth = async (baseUrl: string, tries = 120) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(100);
  }
  throw new Error(`health check failed for ${baseUrl}`);
};

const requestJson = async (baseUrl: string, path: string, init?: RequestInit) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null
  };
};

const createAdminCookie = async (baseUrl: string) => {
  const login = await requestJson(baseUrl, "/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "admin_demo@xllmapi.local",
      password: "admin123456"
    })
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie);
  return String(setCookie).split(";")[0];
};
const startServer = async (env: Record<string, string> = {}) => {
  const port = randomPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = mkdtempSync(join(tmpdir(), "xllmapi-platform-test-"));
  const dbPath = join(tempDir, "platform.db");
  const child = spawn(process.execPath, ["--import", "tsx", "apps/platform-api/src/main.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      XLLMAPI_ENV: "development",
      XLLMAPI_SECRET_KEY: "integration-test-secret",
      XLLMAPI_DB_DRIVER: "sqlite",
      XLLMAPI_DB_PATH: dbPath,
      XLLMAPI_RELEASE_ID: env.XLLMAPI_RELEASE_ID ?? "integration-test",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill("SIGTERM");
    await once(child, "exit");
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`${String(error)}\n${stderr}`.trim());
  }

  return {
    baseUrl,
    dbPath,
    async stop() {
      child.kill("SIGTERM");
      await once(child, "exit");
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
};

test("auth request-code rate limit returns 429 and metrics include counter", async () => {
  const server = await startServer({
    XLLMAPI_AUTH_REQUEST_CODE_LIMIT_PER_MINUTE: "1"
  });

  try {
    const first = await requestJson(server.baseUrl, "/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin_demo@xllmapi.local" })
    });
    assert.equal(first.status, 200);

    const second = await requestJson(server.baseUrl, "/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin_demo@xllmapi.local" })
    });
    assert.equal(second.status, 429);
    assert.equal(second.body?.error?.code, "auth_rate_limited");

    const metricsResponse = await fetch(`${server.baseUrl}/metrics`);
    const metrics = await metricsResponse.text();
    assert.match(metrics, /xllmapi_auth_rate_limit_hits\{[^}]*release_id="integration-test"[^}]*\} 1/);
    assert.match(metrics, /xllmapi_settlement_failures\{/);
  } finally {
    await server.stop();
  }
});

test("logout revokes the current session and ready/version endpoints stay available", async () => {
  const server = await startServer({
    XLLMAPI_RELEASE_ID: "integration-release"
  });

  try {
    const ready = await requestJson(server.baseUrl, "/readyz");
    assert.equal(ready.status, 200);
    assert.equal(ready.body?.ok, true);

    const version = await requestJson(server.baseUrl, "/version");
    assert.equal(version.status, 200);
    assert.equal(version.body?.releaseId, "integration-release");

    const cookieHeader = await createAdminCookie(server.baseUrl);

    const beforeLogout = await requestJson(server.baseUrl, "/v1/auth/session", {
      headers: { cookie: cookieHeader }
    });
    assert.equal(beforeLogout.status, 200);

    const logout = await requestJson(server.baseUrl, "/v1/auth/logout", {
      method: "POST",
      headers: { cookie: cookieHeader }
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body?.ok, true);
    assert.match(String(logout.headers.get("set-cookie")), /Max-Age=0/);

    const afterLogout = await requestJson(server.baseUrl, "/v1/auth/session", {
      headers: { cookie: cookieHeader }
    });
    assert.equal(afterLogout.status, 401);
  } finally {
    await server.stop();
  }
});

test("missing assets return 404 JSON while SPA routes still return HTML", async () => {
  const server = await startServer();

  try {
    const missingAsset = await requestJson(server.baseUrl, "/assets/missing-chunk.js");
    assert.equal(missingAsset.status, 404);
    assert.equal(missingAsset.body?.error?.message, "Not found");

    const spaRoute = await fetch(`${server.baseUrl}/auth`);
    assert.equal(spaRoute.status, 200);
    assert.match(spaRoute.headers.get("content-type") ?? "", /text\/html/);
    const html = await spaRoute.text();
    assert.match(html, /<div id="root">/);
  } finally {
    await server.stop();
  }
});
test("legacy password hashes still login and are rehashed on success", async () => {
  const server = await startServer();

  try {
    const db = new DatabaseSync(server.dbPath);
    const legacyHash = createHash("sha256")
      .update("integration-test-secret:admin123456")
      .digest("hex");
    db.prepare("UPDATE user_passwords SET password_hash = ? WHERE user_id = 'admin_demo'").run(legacyHash);

    const login = await requestJson(server.baseUrl, "/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin_demo@xllmapi.local", password: "admin123456" })
    });
    assert.equal(login.status, 200);
    assert.equal(login.body?.ok, true);
    assert.match(String(login.headers.get("set-cookie")), /xllmapi_session=/);

    const updatedHash = db.prepare("SELECT password_hash AS passwordHash FROM user_passwords WHERE user_id = 'admin_demo' LIMIT 1")
      .get() as { passwordHash: string };
    assert.match(updatedHash.passwordHash, /^scrypt\$1\$/);
  } finally {
    await server.stop();
  }
});
test("admin can inspect and retry settlement failures", async () => {
  const server = await startServer();

  try {
    const cookieHeader = await createAdminCookie(server.baseUrl);
    const db = new DatabaseSync(server.dbPath);
    const failureId = "settlefail_test_retry";
    const requestId = "req_settlement_retry_demo";

    db.prepare(`
      INSERT INTO settlement_failures (
        id,
        request_id,
        requester_user_id,
        supplier_user_id,
        logical_model,
        offering_id,
        provider,
        real_model,
        error_message,
        settlement_payload,
        failure_count,
        first_failed_at,
        last_failed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(
      failureId,
      requestId,
      "user_demo",
      "supplier_openai_demo",
      "gpt-4o-mini",
      "offering_openai_demo",
      "openai",
      "gpt-4o-mini",
      "simulated settlement failure",
      JSON.stringify({
        requestId,
        requesterUserId: "user_demo",
        supplierUserId: "supplier_openai_demo",
        logicalModel: "gpt-4o-mini",
        idempotencyKey: null,
        offeringId: "offering_openai_demo",
        provider: "openai",
        realModel: "gpt-4o-mini",
        inputTokens: 12,
        outputTokens: 6,
        totalTokens: 18,
        fixedPricePer1kInput: 1000,
        fixedPricePer1kOutput: 2000,
        responseBody: { ok: true }
      })
    );

    const openFailures = await requestJson(server.baseUrl, "/v1/admin/settlement-failures?status=open", {
      headers: { cookie: cookieHeader }
    });
    assert.equal(openFailures.status, 200);
    assert.ok(openFailures.body?.data?.some((item: { id: string }) => item.id === failureId));

    const retry = await requestJson(server.baseUrl, `/v1/admin/settlement-failures/${failureId}/retry`, {
      method: "POST",
      headers: { cookie: cookieHeader }
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body?.data?.status, "retried");

    const resolvedFailures = await requestJson(server.baseUrl, "/v1/admin/settlement-failures?status=resolved", {
      headers: { cookie: cookieHeader }
    });
    const resolvedItem = resolvedFailures.body?.data?.find((item: { id: string }) => item.id === failureId);
    assert.ok(resolvedItem);
    assert.ok(resolvedItem.resolvedAt);

    const settlementRecord = db.prepare("SELECT request_id AS requestId FROM settlement_records WHERE request_id = ? LIMIT 1")
      .get(requestId) as { requestId: string } | undefined;
    assert.equal(settlementRecord?.requestId, requestId);

    const ledgerEntryCount = db.prepare("SELECT COUNT(*) AS count FROM ledger_entries WHERE request_id = ?").get(requestId) as { count: number };
    assert.equal(ledgerEntryCount.count, 2);
  } finally {
    await server.stop();
  }
});

test("password reset sends email delivery and updates credentials", async () => {
  const server = await startServer({
    XLLMAPI_APP_BASE_URL: "http://127.0.0.1:3900"
  });

  try {
    const db = new DatabaseSync(server.dbPath);
    const resetRequest = await requestJson(server.baseUrl, "/v1/auth/request-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin_demo@xllmapi.local" })
    });
    assert.equal(resetRequest.status, 200);
    assert.equal(resetRequest.body?.ok, true);

    const delivery = db.prepare(`
      SELECT payload
      FROM email_delivery_attempts
      WHERE template_key = 'password_reset'
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { payload: string } | undefined;
    assert.ok(delivery);
    const payload = JSON.parse(delivery.payload) as { variables?: { actionUrl?: string } };
    const actionUrl = payload.variables?.actionUrl;
    assert.ok(actionUrl);
    const token = new URL(actionUrl).searchParams.get("token");
    assert.ok(token);

    const reset = await requestJson(server.baseUrl, "/v1/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: "ResetPass123!" })
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body?.ok, true);

    const login = await requestJson(server.baseUrl, "/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin_demo@xllmapi.local", password: "ResetPass123!" })
    });
    assert.equal(login.status, 200);
    assert.equal(login.body?.ok, true);

    const securityEvent = db.prepare(`
      SELECT type
      FROM security_events
      WHERE user_id = 'admin_demo' AND type = 'password_reset_completed'
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { type: string } | undefined;
    assert.equal(securityEvent?.type, "password_reset_completed");

    const loginEvent = db.prepare(`
      SELECT type
      FROM security_events
      WHERE user_id = 'admin_demo' AND type = 'login_success'
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { type: string } | undefined;
    assert.equal(loginEvent?.type, "login_success");
  } finally {
    await server.stop();
  }
});

test("email change requires confirmation and updates identity after token confirmation", async () => {
  const server = await startServer({
    XLLMAPI_APP_BASE_URL: "http://127.0.0.1:3901"
  });

  try {
    const db = new DatabaseSync(server.dbPath);
    const cookieHeader = await createAdminCookie(server.baseUrl);
    const newEmail = "admin_new@xllmapi.local";

    const requestChange = await requestJson(server.baseUrl, "/v1/me/security/email", {
      method: "PATCH",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      body: JSON.stringify({ newEmail, currentPassword: "admin123456" })
    });
    assert.equal(requestChange.status, 202);
    assert.equal(requestChange.body?.ok, true);

    const confirmDelivery = db.prepare(`
      SELECT payload
      FROM email_delivery_attempts
      WHERE template_key = 'email_change_confirm'
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { payload: string } | undefined;
    assert.ok(confirmDelivery);
    const confirmPayload = JSON.parse(confirmDelivery.payload) as { variables?: { actionUrl?: string } };
    const confirmToken = new URL(confirmPayload.variables?.actionUrl ?? "").searchParams.get("token");
    assert.ok(confirmToken);

    const confirm = await requestJson(server.baseUrl, "/v1/auth/confirm-email-change", {
      method: "POST",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json"
      },
      body: JSON.stringify({ token: confirmToken })
    });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body?.data?.email, newEmail);

    const identity = db.prepare("SELECT email FROM user_identities WHERE user_id = 'admin_demo' LIMIT 1").get() as { email: string };
    assert.equal(identity.email, newEmail);

    const oldEmailNotice = db.prepare(`
      SELECT COUNT(*) AS count
      FROM email_delivery_attempts
      WHERE template_key IN ('email_change_requested_notice', 'email_changed_notice')
    `).get() as { count: number };
    assert.ok(oldEmailNotice.count >= 2);
  } finally {
    await server.stop();
  }
});

test("admin endpoints expose email deliveries and security events", async () => {
  const server = await startServer({
    XLLMAPI_APP_BASE_URL: "http://127.0.0.1:3902"
  });

  try {
    const cookieHeader = await createAdminCookie(server.baseUrl);
    await requestJson(server.baseUrl, "/v1/auth/request-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin_demo@xllmapi.local" })
    });

    const emailDeliveries = await requestJson(server.baseUrl, "/v1/admin/email-deliveries?limit=20", {
      headers: { cookie: cookieHeader }
    });
    assert.equal(emailDeliveries.status, 200);
    assert.ok(Array.isArray(emailDeliveries.body?.data));
    assert.ok(emailDeliveries.body?.data.some((row: { templateKey: string }) => row.templateKey === "password_reset"));

    const securityEvents = await requestJson(server.baseUrl, "/v1/admin/security-events?limit=20", {
      headers: { cookie: cookieHeader }
    });
    assert.equal(securityEvents.status, 200);
    assert.ok(Array.isArray(securityEvents.body?.data));
  } finally {
    await server.stop();
  }
});
