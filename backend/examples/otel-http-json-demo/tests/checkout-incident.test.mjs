import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkoutDemoRule, checkoutIncident } from "../src/checkout-incident.mjs";

test("checkout demo title describes failures without claiming a rate or confirmed root cause", () => {
  assert.equal(checkoutIncident.title, "Checkout failures detected");
  assert.equal(checkoutIncident.logMessage, "Checkout failed because inventory is unavailable.");
  assert.doesNotMatch(Object.values(checkoutIncident).join(" "), /Phase\s+\d|OTLP|verification|[0-9a-f]{8}-[0-9a-f-]{27}|rate|%|root cause/i);
});

test("checkout demo naming leaves the exact metric selector and threshold policy unchanged", () => {
  const applicationId = "11111111-1111-4111-8111-111111111111";
  const metricName = "checkout_failures_abcdefghijklmnopqrst";
  assert.deepEqual(checkoutDemoRule(metricName, applicationId), {
    name: "Checkout failures detected",
    applicationId,
    type: "metric_threshold",
    enabled: true,
    config: {
      metricName,
      service: "demo-checkout",
      operator: ">=",
      threshold: 1,
      windowMinutes: 5,
      recoveryWindowMinutes: 5,
      stalenessMinutes: 5,
    },
  });
});

test("independent demo runs retain distinct metric selectors despite a shared readable title", () => {
  const applicationId = "11111111-1111-4111-8111-111111111111";
  const first = checkoutDemoRule("checkout_failures_abcdefghijklmnopqrst", applicationId);
  const second = checkoutDemoRule("checkout_failures_tsponmlkjihgfedcbazy", applicationId);
  assert.equal(first.name, second.name);
  assert.notEqual(first.config.metricName, second.config.metricName);
  first.config.threshold = 99;
  assert.equal(second.config.threshold, 1);
});

test("demo producer and verifier use shared copy while retaining run-token and exact trace/span checks", async () => {
  // Wiring regression check, not a substitute for a real SDK/worker end-to-end run.
  const checkout = await readFile(new URL("../src/checkout.mjs", import.meta.url), "utf8");
  const verifier = await readFile(new URL("../scripts/verify-unified-investigation-e2e.mjs", import.meta.url), "utf8");
  assert.match(checkout, /body: checkoutIncident\.logMessage/);
  assert.match(checkout, /description: checkoutIncident\.metricDescription/);
  assert.match(checkout, /"demo\.run_token": unifiedRunToken/);
  assert.match(checkout, /checkoutFailureCounter\?\.add\(1, attributes\)/);
  assert.match(checkout, /unit: "\{failure\}"/);
  assert.match(verifier, /checkoutDemoRule\(metricName, applicationId\)/);
  assert.match(verifier, /searchParams\.set\("applicationId", applicationId\)/);
  assert.match(verifier, /assertStreamApplicationIdentity/);
  assert.match(verifier, /esmInstrumentationHook/);
  assert.doesNotMatch(verifier, /--experimental-loader/);
  assert.match(verifier, /OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: "30000"/);
  assert.match(verifier, /OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: "25000"/);
  assert.match(verifier, /OTEL_EXPORTER_OTLP_LOGS_TIMEOUT: "30000"/);
  assert.match(verifier, /OTEL_METRIC_EXPORT_INTERVAL: "30000"/);
  assert.match(verifier, /OTEL_METRIC_EXPORT_TIMEOUT: "30000"/);
  assert.match(verifier, /DEMO_DRAIN_TIMEOUT_MS/);
  assert.match(verifier, /\[REDACTED_INGESTION_KEY\]/);
  assert.match(verifier, /const message = checkoutIncident\.logMessage/);
  assert.match(verifier, /const metricName = "checkout_failures_" \+ runToken/);
  assert.match(verifier, /assert\.equal\(matches\[0\]\.traceId, traceId\)/);
  assert.match(verifier, /assert\.equal\(matches\[0\]\.spanId, spanId\)/);
  assert.match(verifier, /resourceAttributes\?\.\["demo\.run_token"\]/);
});

test("secure onboarding verifier keeps credentials private and leaves preserved evidence safe", async () => {
  const verifier = await readFile(
    new URL("../scripts/verify-application-onboarding-e2e.mjs", import.meta.url),
    "utf8",
  );

  assert.match(verifier, /const uuidPattern =/);
  assert.match(verifier, /ingestionKeyPattern\.test\(createdKey\.key\)/);
  assert.doesNotMatch(verifier, /assert\.match\(\s*createdKey\.key/);
  assert.match(verifier, /assert\.equal\("secretHash" in createdKey, false\)/);
  assert.match(verifier, /redactSecret\(chunk\.toString\(\), key\)/);
  assert.match(verifier, /detached: process\.platform !== "win32"/);
  assert.match(verifier, /terminateProcessTree\(child\)/);
  assert.match(verifier, /"disable_preserved_rule"/);
  assert.match(verifier, /"revoke_ingestion_key"/);
  assert.match(verifier, /"disable_application"/);
  assert.match(verifier, /crossApplicationIsolationVerified: true/);
  assert.match(verifier, /preservedRuleDisabled: true/);
  assert.match(verifier, /AbortSignal\.timeout\(managementRequestTimeoutMs\)/);
});
