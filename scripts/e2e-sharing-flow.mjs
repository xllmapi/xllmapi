#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { startMockOpenAIProvider } from "./lib/mock-openai-provider.mjs";

const DEEPSEEK_API_KEY = process.env.XLLMAPI_DEEPSEEK_API_KEY || "";
const USE_MOCK_PROVIDER = !DEEPSEEK_API_KEY;

const PORT = Number(process.env.XLLMAPI_E2E_PORT || "3310");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MOCK_PROVIDER_PORT = Number(process.env.XLLMAPI_MOCK_PROVIDER_PORT || String(PORT + 200));
let PROVIDER_BASE_URL = "https://api.deepseek.com";
let PROVIDER_API_KEY = DEEPSEEK_API_KEY || "mock-provider-key";

const randomId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
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
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`health check failed: ${url}`);
};

const requestJson = async (path, init = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`request failed ${response.status} ${path}: ${JSON.stringify(body)}`);
  }
  return body;
};

const createSessionByEmail = async (email) => {
  const requestCode = await requestJson("/v1/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  assert(requestCode.ok && requestCode.devCode, `request-code failed for ${email}`);

  const verified = await requestJson("/v1/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code: requestCode.devCode })
  });
  assert(verified.ok && verified.token, `verify-code failed for ${email}`);
  return verified;
};

const authHeader = (sessionToken) => ({ Authorization: `Bearer ${sessionToken}` });

const updateAdminConfig = async (adminToken, key, value) => {
  const body = await requestJson("/v1/admin/config", {
    method: "PUT",
    headers: {
      ...authHeader(adminToken),
      "content-type": "application/json"
    },
    body: JSON.stringify({ key, value })
  });
  assert(body.data?.ok === true, `admin config update failed for ${key}`);
};

const main = async () => {
  const mockProvider = USE_MOCK_PROVIDER
    ? await startMockOpenAIProvider({ port: MOCK_PROVIDER_PORT })
    : null;
  if (mockProvider) {
    PROVIDER_BASE_URL = mockProvider.baseUrl;
  }

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
      XLLMAPI_DEEPSEEK_API_KEY: DEEPSEEK_API_KEY
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  apiProc.stdout.on("data", (chunk) => process.stdout.write(`[platform] ${chunk}`));
  apiProc.stderr.on("data", (chunk) => process.stderr.write(`[platform:err] ${chunk}`));

  try {
    await waitForHealth(`${BASE_URL}/healthz`);
    console.log("e2e: platform healthy");

    for (const path of ["/", "/docs", "/auth", "/app", "/chat"]) {
      const response = await fetch(`${BASE_URL}${path}`);
      assert(response.ok, `frontend route failed: ${path}`);
    }
    console.log("e2e: frontend routes ok");

    const admin = await createSessionByEmail("admin_demo@xllmapi.local");
    const adminHeaders = {
      ...authHeader(admin.token),
      "content-type": "application/json"
    };
    await updateAdminConfig(admin.token, "invitation_enabled", "true");
    await updateAdminConfig(admin.token, "offering_auto_approve", "true");

    const runId = randomId();
    const supplierEmail = `supplier_${runId}@xllmapi.local`;
    const logicalModel = `community-${runId}`;
    const consumerEmail = `consumer_${runId}@xllmapi.local`;

    await requestJson("/v1/admin/invitations", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email: supplierEmail, note: "supplier e2e" })
    });
    await requestJson("/v1/admin/invitations", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email: consumerEmail, note: "consumer e2e" })
    });
    console.log("e2e: invitations created");

    const supplier = await createSessionByEmail(supplierEmail);
    const supplierHeaders = {
      ...authHeader(supplier.token),
      "content-type": "application/json"
    };
    const supplierMe = await requestJson("/v1/me", { headers: authHeader(supplier.token) });

    const createdCredential = await requestJson("/v1/provider-credentials", {
      method: "POST",
      headers: supplierHeaders,
      body: JSON.stringify({
        providerType: "openai_compatible",
        baseUrl: PROVIDER_BASE_URL,
        apiKey: PROVIDER_API_KEY
      })
    });
    const credentialId = createdCredential.data.id;
    assert(credentialId, "provider credential id missing");

    const createdOffering = await requestJson("/v1/offerings", {
      method: "POST",
      headers: supplierHeaders,
      body: JSON.stringify({
        logicalModel,
        credentialId,
        realModel: "deepseek-chat",
        pricingMode: "fixed_price",
        fixedPricePer1kInput: 250,
        fixedPricePer1kOutput: 450
      })
    });
    const offeringId = createdOffering.data.id;
    assert(offeringId, "offering id missing");
    console.log("e2e: supplier published offering");

    const supplierOfferings = await requestJson("/v1/offerings", { headers: authHeader(supplier.token) });
    const currentOffering = (supplierOfferings.data || []).find((item) => item.id === offeringId);
    assert(currentOffering?.reviewStatus === "approved", "offering is not auto-approved");
    assert(currentOffering?.enabled === true, "offering is not enabled after auto-approval");
    console.log("e2e: offering auto-approved");

    const consumer = await createSessionByEmail(consumerEmail);
    const consumerApiKey = consumer.initialApiKey;
    assert(consumerApiKey, "consumer initial api key missing");

    const chatResponse = await requestJson("/v1/chat/completions", {
      method: "POST",
      headers: {
        "x-api-key": consumerApiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: logicalModel,
        messages: [{ role: "user", content: "Reply with exactly: FLOW_OK" }],
        temperature: 0
      })
    });
    assert(chatResponse.choices?.[0]?.message?.content?.includes("FLOW_OK"), "consumer chat result mismatch");
    console.log("e2e: consumer chat ok");

    await eventually(async () => {
      const supplierUsage = await requestJson("/v1/usage/supply", { headers: authHeader(supplier.token) });
      const consumptionUsage = await requestJson("/v1/usage/consumption", { headers: authHeader(consumer.token) });

      const supplierModelUsage = (supplierUsage.data?.items || []).find((item) => item.logicalModel === logicalModel);
      const consumerModelUsage = (consumptionUsage.data?.items || []).find((item) => item.logicalModel === logicalModel);
      assert(Number(supplierModelUsage?.requestCount || 0) >= 1, "supplier usage not updated");
      assert(Number(consumerModelUsage?.requestCount || 0) >= 1, "consumer usage not updated");
    });

    const publicOfferings = await requestJson(`/v1/public/users/${supplierMe.data.handle}/offerings`);
    assert((publicOfferings.data || []).some((item) => item.logicalModel === logicalModel), "public supplier page missing offering");

    console.log("e2e: sharing flow passed");
  } finally {
    apiProc.kill("SIGTERM");
    await once(apiProc, "exit");
    if (mockProvider) {
      await mockProvider.close();
    }
  }
};

main().catch((error) => {
  console.error("e2e: failed", error);
  process.exit(1);
});
