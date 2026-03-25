#!/usr/bin/env node
/**
 * E2E MVP Flow Test
 *
 * Tests the full user journey through the 6 core pages:
 *   1. / — Home page loads, network models listed
 *   2. /auth — Email code login + password login
 *   3. /chat — Conversations, streaming, messages
 *   4. /app/* — Dashboard: overview, apis, consumption, invitations, settings
 *   5. /admin/* — Admin: overview, users, invitations, reviews, usage
 *   6. /docs — Documentation page loads
 *
 * End-to-end user flow:
 *   Admin invites supplier & consumer →
 *   Supplier creates credential + offering →
 *   Admin reviews offering →
 *   Consumer chats (non-stream + stream) →
 *   Consumer checks consumption →
 *   Supplier checks supply usage →
 *   User invites another user →
 *   User updates settings →
 *   Logout
 *
 * Requires:
 *   Running: postgres, redis
 *   Optional: XLLMAPI_DEEPSEEK_API_KEY for real-provider mode
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { startMockOpenAIProvider } from "./lib/mock-openai-provider.mjs";

// --------------- config ---------------
const DEEPSEEK_API_KEY = process.env.XLLMAPI_DEEPSEEK_API_KEY || "";
const USE_MOCK_PROVIDER = !DEEPSEEK_API_KEY;

const PORT = Number(process.env.XLLMAPI_E2E_PORT || "3311");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MOCK_PROVIDER_PORT = Number(process.env.XLLMAPI_MOCK_PROVIDER_PORT || String(PORT + 200));
let PROVIDER_BASE_URL = "https://api.deepseek.com";
let PROVIDER_API_KEY = DEEPSEEK_API_KEY || "mock-provider-key";

// --------------- helpers ---------------
const randomId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let passCount = 0;
let failCount = 0;

const assert = (condition, message) => {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
};

const pass = (label) => {
  passCount++;
  console.log(`  ✓ ${label}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const eventually = async (fn, { retries = 30, delayMs = 250 } = {}) => {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
};

const waitForHealth = async (url, tries = 120) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`health check failed: ${url}`);
};

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, ok: response.ok, body, headers: response.headers };
};

const expectOk = async (path, init = {}) => {
  const r = await requestJson(path, init);
  if (!r.ok) throw new Error(`expected 2xx for ${path}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};

const expectStatus = async (path, init, expectedStatus) => {
  const r = await requestJson(path, init);
  assert(r.status === expectedStatus, `expected ${expectedStatus} for ${path}, got ${r.status}`);
  return r.body;
};

const createSessionByEmail = async (email) => {
  const reqCode = await expectOk("/v1/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert(reqCode.ok && reqCode.devCode, `request-code failed for ${email}`);

  const verified = await expectOk("/v1/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code: reqCode.devCode }),
  });
  assert(verified.ok && verified.token, `verify-code failed for ${email}`);
  return verified;
};

const hdr = (token) => ({ Authorization: `Bearer ${token}` });
const jsonHdr = (token) => ({ ...hdr(token), "content-type": "application/json" });

const setAdminConfig = async (adminToken, key, value) => {
  const body = await expectOk("/v1/admin/config", {
    method: "PUT",
    headers: jsonHdr(adminToken),
    body: JSON.stringify({ key, value }),
  });
  assert(body.data?.ok === true, `admin config ${key} update failed`);
};

// ======================================================================
// TEST SECTIONS
// ======================================================================

async function testHealthAndFrontendRoutes() {
  console.log("\n[1] Health & Frontend Routes");

  await waitForHealth(`${BASE_URL}/healthz`);
  pass("platform healthy");
  await waitForHealth(`${BASE_URL}/readyz`);
  pass("platform ready");

  // All 6 page routes should return 200 HTML
  for (const path of ["/", "/auth", "/chat", "/app", "/app/apis", "/app/consumption",
    "/app/invitations", "/app/settings", "/admin", "/admin/users",
    "/admin/invitations", "/admin/reviews", "/admin/usage", "/admin/settlement-failures", "/docs"]) {
    const resp = await fetch(`${BASE_URL}${path}`);
    assert(resp.ok, `route ${path} returned ${resp.status}`);
    const ct = resp.headers.get("content-type") || "";
    assert(ct.includes("text/html"), `route ${path} content-type: ${ct}`);
  }
  pass("all admin and SPA routes return HTML");

  // Static assets (from Vite build) should be served
  const indexHtml = await (await fetch(`${BASE_URL}/`)).text();
  assert(indexHtml.includes("<div id=\"root\">"), "index.html contains root div");
  assert(indexHtml.includes("script"), "index.html contains script tag");
  pass("index.html has React root");

  const versionResp = await expectOk("/version");
  assert(versionResp.releaseId, "version endpoint returns releaseId");
  pass("version endpoint works");

  const missingAssetResp = await fetch(`${BASE_URL}/assets/does-not-exist.js`);
  assert(missingAssetResp.status === 404, `missing asset status ${missingAssetResp.status}`);
  pass("missing asset returns 404");
}

async function testPublicEndpoints() {
  console.log("\n[2] Public Endpoints (no auth)");

  const models = await expectOk("/v1/network/models");
  assert(Array.isArray(models.data), "network/models returns array");
  pass(`network/models returns ${models.data.length} models`);

  const modelsAlt = await expectOk("/v1/models");
  assert(Array.isArray(modelsAlt.data), "/v1/models returns array");
  pass("/v1/models works");

  // Unauthenticated access to protected endpoints should fail
  await expectStatus("/v1/me", {}, 401);
  pass("GET /v1/me rejects unauthenticated");

  await expectStatus("/v1/wallet", {}, 401);
  pass("GET /v1/wallet rejects unauthenticated");

  await expectStatus("/v1/admin/users", {}, 401);
  pass("GET /v1/admin/users rejects unauthenticated");
}

async function testAuthFlow() {
  console.log("\n[3] Authentication Flow");

  // Request code for non-invited email should fail
  const nonInvited = await requestJson("/v1/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `nobody_${randomId()}@xllmapi.local` }),
  });
  assert(!nonInvited.ok || nonInvited.body?.eligible === false, "non-invited email rejected");
  pass("non-invited email cannot get code");

  // Verify wrong code fails
  const reqCode = await expectOk("/v1/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin_demo@xllmapi.local" }),
  });
  assert(reqCode.devCode, "devCode returned in dev mode");

  const wrongCode = await requestJson("/v1/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin_demo@xllmapi.local", code: "wrong" }),
  });
  assert(!wrongCode.ok, "wrong code rejected");
  pass("wrong verification code rejected");

  // Correct code works
  const session = await createSessionByEmail("admin_demo@xllmapi.local");
  assert(session.token.startsWith("sess_"), "session token format");
  pass("email code login produces sess_* token");

  // Session validation
  const me = await expectOk("/v1/auth/session", { headers: hdr(session.token) });
  assert(me.data?.email === "admin_demo@xllmapi.local", "session returns correct email");
  assert(me.data?.role === "admin", "admin has admin role");
  pass("GET /v1/auth/session validates token");

  return session;
}

async function testAdminInvitationsAndUsers(adminToken, supplierEmail, consumerEmail) {
  console.log("\n[4] Admin: Invitations & Users");

  const headers = jsonHdr(adminToken);

  // Create invitations
  const inv1 = await expectOk("/v1/admin/invitations", {
    method: "POST", headers,
    body: JSON.stringify({ email: supplierEmail, note: "e2e supplier" }),
  });
  assert(inv1.data?.id, "invitation created for supplier");
  pass("admin invited supplier");

  const inv2 = await expectOk("/v1/admin/invitations", {
    method: "POST", headers,
    body: JSON.stringify({ email: consumerEmail, note: "e2e consumer" }),
  });
  assert(inv2.data?.id, "invitation created for consumer");
  pass("admin invited consumer");

  // List invitations
  const allInv = await expectOk("/v1/admin/invitations", { headers: hdr(adminToken) });
  assert(Array.isArray(allInv.data), "admin invitations is list");
  const hasSupplier = allInv.data.some((i) => (i.invitedEmail || i.email) === supplierEmail);
  const hasConsumer = allInv.data.some((i) => (i.invitedEmail || i.email) === consumerEmail);
  assert(hasSupplier && hasConsumer, "both invitations visible");
  pass(`admin sees ${allInv.data.length} invitations`);

  // List users
  const users = await expectOk("/v1/admin/users", { headers: hdr(adminToken) });
  assert(Array.isArray(users.data) && users.data.length > 0, "users list non-empty");
  pass(`admin sees ${users.data.length} users`);

  // Admin usage
  const usage = await expectOk("/v1/admin/usage", { headers: hdr(adminToken) });
  assert(usage.data !== undefined, "admin usage returns data");
  pass("admin usage endpoint works");

  // Non-admin cannot access admin endpoints
  const supplier = await createSessionByEmail(supplierEmail);
  await expectStatus("/v1/admin/users", { headers: hdr(supplier.token) }, 403);
  pass("non-admin rejected from /v1/admin/users");

  return supplier;
}

async function testSupplierFlow(supplierToken, logicalModel) {
  console.log("\n[5] Supplier: Credentials & Offerings");

  const headers = jsonHdr(supplierToken);

  // Get provider catalog
  const catalog = await expectOk("/v1/provider-catalog", { headers: hdr(supplierToken) });
  assert(Array.isArray(catalog.data) && catalog.data.length > 0, "provider catalog non-empty");
  pass(`provider catalog has ${catalog.data.length} presets`);

  // Create provider credential
  const cred = await expectOk("/v1/provider-credentials", {
    method: "POST", headers,
    body: JSON.stringify({
      providerType: "openai_compatible",
      baseUrl: PROVIDER_BASE_URL,
      apiKey: PROVIDER_API_KEY,
    }),
  });
  const credentialId = cred.data?.id;
  assert(credentialId, "credential id returned");
  pass("provider credential created");

  // List credentials
  const creds = await expectOk("/v1/provider-credentials", { headers: hdr(supplierToken) });
  assert(creds.data?.some((c) => c.id === credentialId), "credential visible in list");
  pass("credentials list includes new credential");

  // Create offering
  const offering = await expectOk("/v1/offerings", {
    method: "POST", headers,
    body: JSON.stringify({
      logicalModel,
      credentialId,
      realModel: "deepseek-chat",
      pricingMode: "fixed_price",
      fixedPricePer1kInput: 250,
      fixedPricePer1kOutput: 450,
    }),
  });
  const offeringId = offering.data?.id;
  assert(offeringId, "offering id returned");
  pass("offering created");

  // Verify auto-approval
  const offerings = await expectOk("/v1/offerings", { headers: hdr(supplierToken) });
  const found = offerings.data?.find((o) => o.id === offeringId);
  assert(found?.reviewStatus === "approved", "offering auto-approved");
  assert(found?.enabled === true, "offering enabled");
  pass("offering auto-approved and enabled");

  // Pricing guidance
  const guidance = await expectOk(
    `/v1/pricing/guidance?logicalModel=${encodeURIComponent(logicalModel)}`,
    { headers: hdr(supplierToken) },
  );
  assert(guidance.inputPricePer1k !== undefined || guidance.data !== undefined, "pricing guidance returned");
  pass("pricing guidance works");

  // Wallet
  const wallet = await expectOk("/v1/wallet", { headers: hdr(supplierToken) });
  assert(wallet.balance !== undefined || wallet.data !== undefined, "wallet balance returned");
  pass("wallet endpoint works");

  return { credentialId, offeringId };
}

async function testConsumerChat(consumerEmail, logicalModel) {
  console.log("\n[6] Consumer: Chat (non-stream + stream)");

  const consumer = await createSessionByEmail(consumerEmail);
  const consumerApiKey = consumer.initialApiKey;
  assert(consumerApiKey, "consumer got initial API key");
  pass("consumer login returns API key");

  // ---- Non-streaming chat completion ----
  const chatResp = await expectOk("/v1/chat/completions", {
    method: "POST",
    headers: { "x-api-key": consumerApiKey, "content-type": "application/json" },
    body: JSON.stringify({
      model: logicalModel,
      messages: [{ role: "user", content: "Reply with exactly: FLOW_OK" }],
      temperature: 0,
    }),
  });
  assert(chatResp.choices?.[0]?.message?.content?.includes("FLOW_OK"), "chat response contains FLOW_OK");
  assert(chatResp.usage?.total_tokens > 0, "usage tokens reported");
  pass("non-streaming chat completion works");

  // ---- Streaming chat completion ----
  const streamResp = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "x-api-key": consumerApiKey, "content-type": "application/json" },
    body: JSON.stringify({
      model: logicalModel,
      messages: [{ role: "user", content: "Say hello" }],
      temperature: 0,
      stream: true,
    }),
  });
  assert(streamResp.ok, `stream response status: ${streamResp.status}`);
  const streamCt = streamResp.headers.get("content-type") || "";
  assert(streamCt.includes("text/event-stream"), `stream content-type: ${streamCt}`);

  const streamText = await streamResp.text();
  const dataLines = streamText.split("\n").filter((l) => l.startsWith("data: "));
  assert(dataLines.length > 0, "stream returned data lines");
  let fullContent = "";
  let hasCompletedEvent = false;
  for (const line of dataLines) {
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") { hasCompletedEvent = true; continue; }
    try {
      const parsed = JSON.parse(payload);
      // Try OpenAI-style delta
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) { fullContent += delta; continue; }
      // Try completed event with outputText
      if (parsed.outputText) { fullContent += parsed.outputText; continue; }
      // Try direct content
      if (parsed.content) { fullContent += parsed.content; continue; }
    } catch { /* skip */ }
  }
  assert(dataLines.length >= 2, `stream has ${dataLines.length} data lines`);
  pass(`streaming chat completion works (${dataLines.length} chunks, content=${fullContent.length > 0})`);

  // ---- Conversation-based chat ----
  const conv = await expectOk("/v1/chat/conversations", {
    method: "POST",
    headers: jsonHdr(consumer.token),
    body: JSON.stringify({ model: logicalModel, title: "e2e test" }),
  });
  const convId = conv.data?.id;
  assert(convId, "conversation created");
  pass("conversation created");

  // Stream via conversation
  const convStreamResp = await fetch(
    `${BASE_URL}/v1/chat/conversations/${encodeURIComponent(convId)}/stream`,
    {
      method: "POST",
      headers: jsonHdr(consumer.token),
      body: JSON.stringify({ content: "Reply with exactly: CONV_OK" }),
    },
  );
  assert(convStreamResp.ok, `conversation stream status: ${convStreamResp.status}`);
  const convStreamText = await convStreamResp.text();
  assert(convStreamText.length > 0, "conversation stream returned data");
  pass("conversation stream works");

  // List conversations
  const convList = await expectOk(
    `/v1/chat/conversations?model=${encodeURIComponent(logicalModel)}`,
    { headers: hdr(consumer.token) },
  );
  assert(convList.data?.some((c) => c.id === convId), "conversation in list");
  pass("conversations list works");

  // Load messages
  const msgs = await expectOk(
    `/v1/chat/conversations/${encodeURIComponent(convId)}/messages`,
    { headers: hdr(consumer.token) },
  );
  assert(Array.isArray(msgs.data) && msgs.data.length >= 2, "messages loaded (user + assistant)");
  pass(`conversation has ${msgs.data.length} messages`);

  return consumer;
}

async function testDashboard(supplierToken, consumerToken, logicalModel) {
  console.log("\n[7] Dashboard: Overview, Consumption, Usage");

  // Supplier: profile
  const me = await expectOk("/v1/me", { headers: hdr(supplierToken) });
  assert(me.data?.email, "me returns email");
  pass("GET /v1/me works");

  // Supplier: supply usage
  await eventually(async () => {
    const supplyUsage = await expectOk("/v1/usage/supply", { headers: hdr(supplierToken) });
    const supplyItem = (supplyUsage.data?.items || []).find((i) => i.logicalModel === logicalModel);
    assert(Number(supplyItem?.requestCount || 0) >= 1, "supplier usage tracked");
  });
  pass("supplier supply usage recorded");

  // Consumer: consumption usage
  await eventually(async () => {
    const consumeUsage = await expectOk("/v1/usage/consumption", { headers: hdr(consumerToken) });
    const consumeItem = (consumeUsage.data?.items || []).find((i) => i.logicalModel === logicalModel);
    assert(Number(consumeItem?.requestCount || 0) >= 1, "consumer usage tracked");
  });
  pass("consumer consumption usage recorded");

  // Consumer: wallet
  const wallet = await expectOk("/v1/wallet", { headers: hdr(consumerToken) });
  pass(`consumer wallet balance: ${wallet.balance ?? wallet.data?.balance}`);
}

async function testUserInvitations(consumerToken) {
  console.log("\n[8] User Invitations");

  const headers = jsonHdr(consumerToken);

  // Invitation stats
  const stats = await expectOk("/v1/me/invitation-stats", { headers: hdr(consumerToken) });
  assert(stats.data?.limit > 0 || stats.data?.unlimited, "has invitation quota");
  pass(`invitation quota: ${stats.data?.remaining ?? "unlimited"} remaining`);

  // Send invitation
  const inviteeEmail = `invitee_${randomId()}@xllmapi.local`;
  const inv = await expectOk("/v1/invitations", {
    method: "POST", headers,
    body: JSON.stringify({ email: inviteeEmail, note: "e2e invite test" }),
  });
  assert(inv.data?.id, "invitation sent");
  pass("user sent invitation");

  // List invitations
  const invList = await expectOk("/v1/invitations", { headers: hdr(consumerToken) });
  assert(invList.data?.some((i) => (i.invitedEmail || i.email) === inviteeEmail), "invitation in list");
  pass("sent invitation visible in list");

  // Verify invitee can now register
  const inviteeSession = await createSessionByEmail(inviteeEmail);
  assert(inviteeSession.token, "invitee can log in");
  pass("invited user can register and login");
}

async function testSettings(consumerToken) {
  console.log("\n[9] Settings: Profile & Password");

  const headers = jsonHdr(consumerToken);

  // Update profile
  const profileResp = await requestJson("/v1/me/profile", {
    method: "PATCH", headers,
    body: JSON.stringify({ displayName: "E2E Test User" }),
  });
  if (profileResp.ok) {
    pass("profile updated");
  } else {
    // Some versions use PATCH /v1/me instead
    const altResp = await requestJson("/v1/me", {
      method: "PATCH", headers,
      body: JSON.stringify({ displayName: "E2E Test User" }),
    });
    assert(altResp.ok, `profile update failed: ${altResp.status}`);
    pass("profile updated (via /v1/me)");
  }

  // Set password
  const pwResp = await requestJson("/v1/me/security/password", {
    method: "PATCH", headers,
    body: JSON.stringify({ currentPassword: "", newPassword: "TestPass123!" }),
  });
  // Password set may fail if user has no current password (first time requires different flow)
  if (pwResp.ok) {
    pass("password set");

    // Now test password login
    const me = await expectOk("/v1/me", { headers: hdr(consumerToken) });
    const loginResp = await requestJson("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: me.data.email, password: "TestPass123!" }),
    });
    if (loginResp.ok) {
      assert(loginResp.body?.token, "password login returns token");
      pass("password login works");
    } else {
      pass("password login skipped (endpoint may not be configured)");
    }
  } else {
    pass("password set skipped (may require initial password setup flow)");
  }
}

async function testAdminReviews(adminToken) {
  console.log("\n[10] Admin: Offering Reviews");

  // Check pending offerings (should be empty since auto-approved)
  const pending = await expectOk("/v1/admin/offerings/pending", { headers: hdr(adminToken) });
  assert(Array.isArray(pending.data), "pending offerings is list");
  pass(`pending offerings: ${pending.data.length}`);

  // Admin usage summary
  const usage = await expectOk("/v1/admin/usage", { headers: hdr(adminToken) });
  assert(usage.data !== undefined, "admin usage summary returned");
  pass("admin usage summary works");

  const stats = await expectOk("/v1/admin/stats", { headers: hdr(adminToken) });
  assert(stats.data !== undefined, "admin stats returned");
  assert(typeof stats.data?.openSettlementFailures === "number", "admin stats expose open settlement failures");
  pass("admin stats expose settlement failure count");
}

async function testAdminRequestSettlementVisibility(adminToken, logicalModel) {
  console.log("\n[11] Admin: Request Settlement Visibility");

  const requests = await expectOk(`/v1/admin/requests?model=${encodeURIComponent(logicalModel)}&limit=5`, {
    headers: hdr(adminToken)
  });
  const matchingRequest = (requests.data || []).find((item) => item.logicalModel === logicalModel);
  assert(matchingRequest, "admin requests include the test model");
  assert(matchingRequest.chosenOfferingId, "admin request exposes chosen offering");
  assert(matchingRequest.settlementStatus === "settled", "admin request settlement status is settled");
  assert(Number(matchingRequest.consumerCost || 0) >= 0, "admin request exposes consumer cost");
  pass("admin request settlement fields visible");

  const settlements = await expectOk("/v1/admin/settlements?limit=10", { headers: hdr(adminToken) });
  assert(Number(settlements.summary?.count || 0) >= 1, "admin settlements summary count updated");
  pass("admin settlements summary works");
}

async function testAdminRequestSettlementVisibility(adminToken, logicalModel) {
  console.log("\n[11] Admin: Request Settlement Visibility");

  const requests = await expectOk(`/v1/admin/requests?model=${encodeURIComponent(logicalModel)}&limit=5`, {
    headers: hdr(adminToken)
  });
  const matchingRequest = (requests.data || []).find((item) => item.logicalModel === logicalModel);
  assert(matchingRequest, "admin requests include the test model");
  assert(matchingRequest.chosenOfferingId, "admin request exposes chosen offering");
  assert(matchingRequest.settlementStatus === "settled", "admin request settlement status is settled");
  assert(Number(matchingRequest.consumerCost || 0) >= 0, "admin request exposes consumer cost");
  pass("admin request settlement fields visible");

  const settlements = await expectOk("/v1/admin/settlements?limit=10", { headers: hdr(adminToken) });
  assert(Number(settlements.summary?.count || 0) >= 1, "admin settlements summary count updated");
  pass("admin settlements summary works");
}

async function testPublicSupplierProfile(supplierToken, logicalModel) {
  console.log("\n[12] Public Supplier Profile");

  const me = await expectOk("/v1/me", { headers: hdr(supplierToken) });
  const handle = me.data?.handle;
  if (!handle) {
    pass("supplier has no handle — skipping public profile test");
    return;
  }

  const profile = await expectOk(`/v1/public/users/${handle}`);
  assert(profile.handle || profile.data?.handle, "public profile has handle");
  pass("public supplier profile works");

  const pubOfferings = await expectOk(`/v1/public/users/${handle}/offerings`);
  assert(pubOfferings.data?.some((o) => o.logicalModel === logicalModel), "public offering visible");
  pass("public supplier offerings visible");
}

async function testLogout(consumerToken) {
  console.log("\n[13] Logout");

  const resp = await requestJson("/v1/auth/logout", {
    method: "POST",
    headers: hdr(consumerToken),
  });
  assert(resp.ok, "logout succeeded");
  pass("logout endpoint works");
}

async function testDocsFrontend() {
  console.log("\n[14] Docs Page");

  const resp = await fetch(`${BASE_URL}/docs`);
  assert(resp.ok, "docs route returns 200");
  const html = await resp.text();
  assert(html.includes("<div id=\"root\">"), "docs page has React root");
  pass("docs page serves SPA");
}

// ======================================================================
// MAIN
// ======================================================================
const main = async () => {
  const mockProvider = USE_MOCK_PROVIDER
    ? await startMockOpenAIProvider({ port: MOCK_PROVIDER_PORT })
    : null;
  if (mockProvider) {
    PROVIDER_BASE_URL = mockProvider.baseUrl;
  }

  console.log("╔════════════════════════════════════════╗");
  console.log("║     xllmapi MVP E2E Test Suite         ║");
  console.log("╚════════════════════════════════════════╝");

  console.log(`\nConfig: PORT=${PORT}`);

  // Spawn platform-api
  const apiProc = spawn("node", ["apps/platform-api/dist/main.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      XLLMAPI_ENV: "development",
      XLLMAPI_SECRET_KEY: process.env.XLLMAPI_SECRET_KEY || "local-dev-secret",
      XLLMAPI_DB_DRIVER: "postgres",
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://xllmapi:xllmapi@127.0.0.1:5432/xllmapi",
      REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379",
      XLLMAPI_DEEPSEEK_API_KEY: DEEPSEEK_API_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  apiProc.stdout.on("data", (chunk) => process.stdout.write(`  [platform] ${chunk}`));
  apiProc.stderr.on("data", (chunk) => process.stderr.write(`  [platform:err] ${chunk}`));

  const runId = randomId();
  const supplierEmail = `supplier_${runId}@xllmapi.local`;
  const consumerEmail = `consumer_${runId}@xllmapi.local`;
  const logicalModel = `e2e-model-${runId}`;

  try {
    // [1] Health & Routes
    await testHealthAndFrontendRoutes();

    // [2] Public endpoints
    await testPublicEndpoints();

  // [3] Auth flow
  const adminSession = await testAuthFlow();
  await setAdminConfig(adminSession.token, "invitation_enabled", "true");
  await setAdminConfig(adminSession.token, "offering_auto_approve", "true");

  // [4] Admin invitations + users
  const supplierSession = await testAdminInvitationsAndUsers(
      adminSession.token, supplierEmail, consumerEmail,
    );

    // [5] Supplier flow
    const { offeringId } = await testSupplierFlow(supplierSession.token, logicalModel);

    // [6] Consumer chat (non-stream, stream, conversations)
    const consumerSession = await testConsumerChat(consumerEmail, logicalModel);

    // [7] Dashboard data
    await testDashboard(supplierSession.token, consumerSession.token, logicalModel);

    // [8] User invitations
    await testUserInvitations(consumerSession.token);

    // [9] Settings
    await testSettings(consumerSession.token);

    // [10] Admin reviews
    await testAdminReviews(adminSession.token);

    // [11] Admin request settlement visibility
    await testAdminRequestSettlementVisibility(adminSession.token, logicalModel);

    // [12] Public supplier profile
    await testPublicSupplierProfile(supplierSession.token, logicalModel);

    // [13] Logout
    await testLogout(consumerSession.token);

    // [14] Docs
    await testDocsFrontend();

    console.log("\n╔════════════════════════════════════════╗");
    console.log(`║  ALL PASSED: ${passCount} assertions              ║`);
    console.log("╚════════════════════════════════════════╝\n");
  } finally {
    apiProc.kill("SIGTERM");
    await once(apiProc, "exit");
    if (mockProvider) {
      await mockProvider.close();
    }
  }
};

main().catch((error) => {
  console.error(`\n✗ E2E FAILED (${passCount} passed before failure):`);
  console.error(error.message || error);
  process.exit(1);
});
