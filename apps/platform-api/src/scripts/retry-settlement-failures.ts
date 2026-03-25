import { cacheService } from "../cache.js";
import { config } from "../config.js";
import { platformService } from "../services/platform-service.js";
import { closePool } from "../repositories/postgres-platform-repository.js";

const EXIT_SUCCESS = 0;
const EXIT_INVALID_CONFIG = 2;
const EXIT_RETRY_FAILURES = 3;
const EXIT_OPEN_REMAINING = 4;

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid positive integer: ${raw}`);
  }

  return parsed;
};

const actorUserId = process.env.XLLMAPI_SETTLEMENT_RETRY_ACTOR_ID
  ?? (config.isProduction ? null : "admin_demo");

const batchLimit = parsePositiveInt(process.env.XLLMAPI_SETTLEMENT_RETRY_LIMIT, 100);
const dryRun = process.env.XLLMAPI_SETTLEMENT_RETRY_DRY_RUN === "1";
const failOnOpenRemaining = process.env.XLLMAPI_SETTLEMENT_RETRY_FAIL_ON_OPEN_REMAINING === "1";

const main = async () => {
  if (!actorUserId) {
    throw new Error("XLLMAPI_SETTLEMENT_RETRY_ACTOR_ID is required in production");
  }

  const initial = await platformService.getAdminSettlementFailures({
    page: 1,
    limit: batchLimit,
    status: "open"
  });

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      actorUserId,
      batchLimit,
      openCount: initial.total,
      preview: initial.data.map((failure) => ({
        id: failure.id,
        requestId: failure.requestId,
        logicalModel: failure.logicalModel,
        requesterEmail: failure.requesterEmail,
        lastFailedAt: failure.lastFailedAt,
        failureCount: failure.failureCount
      }))
    }, null, 2));
    process.exitCode = failOnOpenRemaining && initial.total > 0 ? EXIT_OPEN_REMAINING : EXIT_SUCCESS;
    return;
  }

  let attempted = 0;
  let retried = 0;
  let alreadySettled = 0;
  let failed = 0;

  while (attempted < batchLimit) {
    const remaining = batchLimit - attempted;
    const result = await platformService.getAdminSettlementFailures({
      page: 1,
      limit: Math.min(remaining, 50),
      status: "open"
    });

    if (!result.data.length) {
      break;
    }

    for (const failure of result.data) {
      if (attempted >= batchLimit) {
        break;
      }

      attempted += 1;
      const retry = await platformService.retrySettlementFailure({
        failureId: failure.id,
        actorUserId
      });

      if (retry.ok && retry.data?.status === "retried") {
        retried += 1;
        console.log(`[settlement-retry] retried request=${failure.requestId} failure=${failure.id}`);
        continue;
      }

      if (retry.ok && retry.data?.status === "already_settled") {
        alreadySettled += 1;
        console.log(`[settlement-retry] already-settled request=${failure.requestId} failure=${failure.id}`);
        continue;
      }

      failed += 1;
      console.error(`[settlement-retry] retry failed request=${failure.requestId} failure=${failure.id} error=${retry.message ?? retry.code ?? "unknown"}`);
    }
  }

  const remaining = await platformService.getAdminSettlementFailures({
    page: 1,
    limit: 1,
    status: "open"
  });

  console.log(JSON.stringify({
    ok: failed === 0 && (!failOnOpenRemaining || remaining.total === 0),
    actorUserId,
    batchLimit,
    dryRun: false,
    openCountBefore: initial.total,
    openCountAfter: remaining.total,
    attempted,
    retried,
    alreadySettled,
    failed
  }, null, 2));

  if (failed > 0) {
    process.exitCode = EXIT_RETRY_FAILURES;
    return;
  }

  if (failOnOpenRemaining && remaining.total > 0) {
    process.exitCode = EXIT_OPEN_REMAINING;
    return;
  }
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_INVALID_CONFIG;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      // ignore
    }
    try {
      await cacheService.close();
    } catch {
      // ignore
    }
  });
