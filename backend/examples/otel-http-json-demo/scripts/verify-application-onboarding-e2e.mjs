import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const demoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const localDevelopmentApplicationId =
  "00000000-0000-4000-8000-000000000001";
const unifiedVerifier = path.join(
  demoRoot,
  "scripts",
  "verify-unified-investigation-e2e.mjs",
);
const tsxCli = path.resolve(
  demoRoot,
  "../../node_modules/tsx/dist/cli.mjs",
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ingestionKeyPattern =
  /^op_ingest_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/;
const managementRequestTimeoutMs = 30_000;
const unifiedVerifierTimeoutMs = 360_000;

function token(bytes = 8) {
  return randomBytes(bytes).toString("hex");
}

async function requestJson(pathname, init = {}, expectedStatus = 200) {
  const response = await fetch(new URL(pathname, backendUrl), {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(managementRequestTimeoutMs),
  });
  const text = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(
      (init.method ?? "GET") +
        " " +
        pathname +
        " expected HTTP " +
        expectedStatus +
        " but received " +
        response.status +
        ".",
    );
  }

  if (text.length === 0) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      (init.method ?? "GET") +
        " " +
        pathname +
        " returned invalid JSON.",
    );
  }
}

async function postOtlp(pathname, payload, key, expectedStatus) {
  const headers = { "content-type": "application/json" };
  if (key !== undefined) {
    headers.authorization = "Bearer " + key;
  }

  return requestJson(
    pathname,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    expectedStatus,
  );
}

function emptyEnvelope(signal) {
  if (signal === "traces") return { resourceSpans: [] };
  if (signal === "metrics") return { resourceMetrics: [] };
  return { resourceLogs: [] };
}

function identityProbeEnvelope(traceId, spanId) {
  const start = BigInt(Date.now()) * 1_000_000n;
  return {
    applicationId: localDevelopmentApplicationId,
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "phase14b-identity-probe" },
            },
            {
              key: "application.id",
              value: { stringValue: localDevelopmentApplicationId },
            },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId,
                parentSpanId: "",
                name: "phase14b trusted identity probe",
                startTimeUnixNano: start.toString(),
                endTimeUnixNano: (start + 1_000_000n).toString(),
                status: { code: 1 },
                attributes: [
                  {
                    key: "applicationId",
                    value: { stringValue: localDevelopmentApplicationId },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function waitForTrace(applicationId, traceId) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const query =
      "/v1/traces/" +
      encodeURIComponent(traceId) +
      "?applicationId=" +
      encodeURIComponent(applicationId);
    let tree;
    try {
      tree = await requestJson(query);
    } catch (error) {
      if (error?.name !== "TimeoutError" && error?.name !== "AbortError") {
        throw error;
      }
    }

    if (Array.isArray(tree) && tree.length > 0) {
      return tree;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("The trusted-identity probe was not stored within 60 seconds.");
}

function redactSecret(value, secret) {
  if (typeof secret !== "string" || secret.length === 0) return value;
  return value.split(secret).join("[REDACTED_INGESTION_KEY]");
}

function signalProcessTree(child, signal) {
  if (
    process.platform !== "win32" &&
    typeof child.pid === "number"
  ) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
      return;
    }
  }
  child.kill(signal);
}

async function terminateProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  signalProcessTree(child, "SIGTERM");
  const graceful = await Promise.race([
    closed.then(() => true),
    delay(5_000).then(() => false),
  ]);

  if (
    !graceful &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    signalProcessTree(child, "SIGKILL");
    await closed;
  }
}

async function runUnifiedVerifier(applicationId, key) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let settled = false;
    const child = spawn(
      process.execPath,
      [tsxCli, unifiedVerifier, "--preserve"],
      {
        cwd: demoRoot,
        env: {
          ...process.env,
          DEMO_APPLICATION_ID: applicationId,
          DEMO_INGESTION_KEY: key,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    );

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void terminateProcessTree(child).then(
        () => reject(new Error("The unified verifier exceeded six minutes.")),
        (error) =>
          reject(
            new AggregateError(
              [error],
              "The unified verifier timed out and process cleanup failed.",
            ),
          ),
      );
    }, unifiedVerifierTimeoutMs);

    child.stdout.on("data", (chunk) => {
      const value = redactSecret(chunk.toString(), key);
      process.stdout.write(value);
      stdout += value;
      if (stdout.length > 4_000_000) {
        stdout = stdout.slice(-2_000_000);
      }
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(redactSecret(chunk.toString(), key));
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(
          new Error(
            "The unified verifier failed (code=" +
              String(code) +
              ", signal=" +
              String(signal) +
              ").",
          ),
        );
        return;
      }

      const marker =
        '{\n  "event": "otel_http_json_unified_investigation_verified"';
      const markerIndex = stdout.lastIndexOf(marker);
      if (markerIndex < 0) {
        reject(new Error("The unified verifier did not return its result record."));
        return;
      }

      try {
        resolve(JSON.parse(stdout.slice(markerIndex).trim()));
      } catch {
        reject(new Error("The unified verifier returned malformed result JSON."));
      }
    });
  });
}

async function bestEffort(label, work) {
  try {
    await work();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "phase14b_cleanup_failed",
        cleanup: label,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function verifySecureOnboarding() {
  await requestJson("/health");

  for (const [pathName, signal] of [
    ["/v1/traces", "traces"],
    ["/otlp/v1/metrics", "metrics"],
    ["/otlp/v1/logs", "logs"],
  ]) {
    await postOtlp(pathName, emptyEnvelope(signal), undefined, 401);
  }

  const unknownKey =
    "op_ingest_" + token(8) + "_" + randomBytes(32).toString("base64url");
  await postOtlp("/v1/traces", emptyEnvelope("traces"), unknownKey, 401);

  const runId = token(6);
  let application;
  let createdKey;
  let keyRevoked = false;
  let preservedRuleId;
  let preservedRuleDisabled = false;

  try {
    application = await requestJson(
      "/v1/applications",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Phase 14B secure onboarding " + runId,
        }),
      },
      201,
    );
    assert.equal(uuidPattern.test(application.id), true);
    assert.equal(application.status, "active");

    createdKey = await requestJson(
      "/v1/applications/" +
        encodeURIComponent(application.id) +
        "/ingest-keys",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Phase 14B acceptance key" }),
      },
      201,
    );
    assert.equal(
      ingestionKeyPattern.test(createdKey.key),
      true,
      "Created ingestion key has the expected format.",
    );
    assert.equal("secretHash" in createdKey, false);

    const keysBeforeUse = await requestJson(
      "/v1/applications/" +
        encodeURIComponent(application.id) +
        "/ingest-keys",
    );
    assert.equal(keysBeforeUse.length, 1);
    assert.equal(keysBeforeUse[0].prefix, createdKey.prefix);
    assert.equal("key" in keysBeforeUse[0], false);
    assert.equal("secretHash" in keysBeforeUse[0], false);

    await postOtlp(
      "/v1/traces",
      emptyEnvelope("traces"),
      createdKey.key,
      200,
    );
    await postOtlp(
      "/otlp/v1/metrics",
      emptyEnvelope("metrics"),
      createdKey.key,
      200,
    );
    await postOtlp(
      "/otlp/v1/logs",
      emptyEnvelope("logs"),
      createdKey.key,
      200,
    );

    const probeTraceId = randomBytes(16).toString("hex");
    const probeSpanId = randomBytes(8).toString("hex");
    await postOtlp(
      "/v1/traces",
      identityProbeEnvelope(probeTraceId, probeSpanId),
      createdKey.key,
      200,
    );
    const trustedTree = await waitForTrace(application.id, probeTraceId);
    assert.equal(trustedTree.length, 1);
    assert.equal(trustedTree[0].applicationId, application.id);
    const forgedTree = await requestJson(
      "/v1/traces/" +
        encodeURIComponent(probeTraceId) +
        "?applicationId=" +
        encodeURIComponent(localDevelopmentApplicationId),
    );
    assert.deepEqual(forgedTree, []);

    const unified = await runUnifiedVerifier(application.id, createdKey.key);
    assert.equal(unified.applicationId, application.id);
    assert.equal(unified.preserved, true);
    assert.equal(unified.newDlqEntries, 0);
    preservedRuleId = unified.ruleId;

    const localMetrics = await requestJson(
      "/v1/metrics?applicationId=" +
        encodeURIComponent(localDevelopmentApplicationId) +
        "&service=demo-checkout&name=" +
        encodeURIComponent("checkout_failures_" + unified.runToken) +
        "&limit=100",
    );
    assert.deepEqual(localMetrics.data ?? [], []);
    const localLogs = await requestJson(
      "/v1/logs?applicationId=" +
        encodeURIComponent(localDevelopmentApplicationId) +
        "&traceId=" +
        encodeURIComponent(unified.traceId) +
        "&service=demo-checkout&level=error",
    );
    assert.deepEqual(localLogs.data ?? [], []);

    const disabledRule = await requestJson(
      "/v1/alert-rules/" + encodeURIComponent(preservedRuleId),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
    assert.equal(disabledRule.enabled, false);
    preservedRuleDisabled = true;

    const keysAfterUse = await requestJson(
      "/v1/applications/" +
        encodeURIComponent(application.id) +
        "/ingest-keys",
    );
    assert.equal(keysAfterUse.length, 1);
    assert.equal("key" in keysAfterUse[0], false);
    assert.ok(keysAfterUse[0].lastUsedAt);

    const disabled = await requestJson(
      "/v1/applications/" + encodeURIComponent(application.id),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "disabled" }),
      },
    );
    assert.equal(disabled.status, "disabled");
    await postOtlp(
      "/v1/traces",
      emptyEnvelope("traces"),
      createdKey.key,
      403,
    );

    const enabled = await requestJson(
      "/v1/applications/" + encodeURIComponent(application.id),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      },
    );
    assert.equal(enabled.status, "active");

    await requestJson(
      "/v1/applications/" +
        encodeURIComponent(application.id) +
        "/ingest-keys/" +
        encodeURIComponent(createdKey.id),
      { method: "DELETE" },
      204,
    );
    keyRevoked = true;
    await postOtlp(
      "/v1/traces",
      emptyEnvelope("traces"),
      createdKey.key,
      401,
    );

    const finalApplication = await requestJson(
      "/v1/applications/" + encodeURIComponent(application.id),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "disabled" }),
      },
    );
    assert.equal(finalApplication.status, "disabled");

    const result = {
      event: "phase14b_secure_onboarding_verified",
      applicationId: application.id,
      applicationName: application.name,
      keyId: createdKey.id,
      keyPrefix: createdKey.prefix,
      finalApplicationStatus: finalApplication.status,
      finalKeyStatus: "revoked",
      trustedIdentityProbeTraceId: probeTraceId,
      alertId: unified.alertId,
      ruleId: unified.ruleId,
      frontendUrl: unified.frontendUrl,
      signals: {
        traces: true,
        metrics: true,
        logs: true,
      },
      missingKeyRejected: true,
      unknownKeyRejected: true,
      disabledApplicationRejected: true,
      revokedKeyRejected: true,
      secretAbsentFromListings: true,
      crossApplicationIsolationVerified: true,
      preservedRuleDisabled: true,
      newDlqEntries: unified.newDlqEntries,
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (preservedRuleId !== undefined && !preservedRuleDisabled) {
      await bestEffort("disable_preserved_rule", () =>
        requestJson(
          "/v1/alert-rules/" + encodeURIComponent(preservedRuleId),
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: false }),
          },
        ),
      );
    }
    if (application !== undefined && createdKey !== undefined && !keyRevoked) {
      await bestEffort("revoke_ingestion_key", () =>
        requestJson(
          "/v1/applications/" +
            encodeURIComponent(application.id) +
            "/ingest-keys/" +
            encodeURIComponent(createdKey.id),
          { method: "DELETE" },
          204,
        ),
      );
    }
    if (application !== undefined) {
      await bestEffort("disable_application", () =>
        requestJson(
          "/v1/applications/" + encodeURIComponent(application.id),
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "disabled" }),
          },
        ),
      );
    }
  }
}

await verifySecureOnboarding();
