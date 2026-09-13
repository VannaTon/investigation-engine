import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createClient } from "redis";

import {
  compareInvestigationCauseCandidateRanks,
  INVESTIGATION_RANKING_DIMENSIONS,
} from "../../../src/services/investigation-cause-candidate-ranking-comparison.service.ts";

const demoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const gatewayPort = Number(process.env.GATEWAY_PORT ?? 41_001);
const checkoutPort = Number(process.env.CHECKOUT_PORT ?? 41_002);
const protocol = "http/json";
const compression = "none";
const preserveInvestigation = process.argv.includes("--preserve");
const children = [];
let createdRuleId;

function alphabeticToken(length = 20) {
  return [...randomBytes(length)]
    .map((value) => String.fromCharCode(97 + (value % 26)))
    .join("");
}

async function requestJson(pathname, init = {}, expectedStatus = 200) {
  const response = await fetch(backendUrl + pathname, init);
  const text = await response.text();
  let body;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (response.status !== expectedStatus) {
    throw new Error(
      (init.method ?? "GET") +
        " " +
        pathname +
        " returned HTTP " +
        response.status +
        ": " +
        text,
    );
  }

  return body;
}

function serviceEnvironment(serviceName, runToken, metricName) {
  const emitsFailureSignals = serviceName === "demo-checkout";

  return {
    ...process.env,
    OTEL_SERVICE_NAME: serviceName,
    OTEL_RESOURCE_ATTRIBUTES:
      "deployment.environment.name=phase7,demo.run_token=" + runToken,
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_METRICS_EXPORTER: emitsFailureSignals ? "otlp" : "none",
    OTEL_LOGS_EXPORTER: emitsFailureSignals ? "otlp" : "none",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: backendUrl + "/v1/traces",
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: protocol,
    OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: compression,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:
      backendUrl + "/otlp/v1/metrics",
    OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: protocol,
    OTEL_EXPORTER_OTLP_METRICS_COMPRESSION: compression,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: backendUrl + "/otlp/v1/logs",
    OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: protocol,
    OTEL_EXPORTER_OTLP_LOGS_COMPRESSION: compression,
    OTEL_PROPAGATORS: "tracecontext,baggage",
    OTEL_TRACES_SAMPLER: "always_on",
    OTEL_NODE_ENABLED_INSTRUMENTATIONS: "http",
    OTEL_NODE_RESOURCE_DETECTORS: "env,process",
    OTEL_BSP_SCHEDULE_DELAY: "200",
    OTEL_BSP_EXPORT_TIMEOUT: "30000",
    OTEL_BLRP_SCHEDULE_DELAY: "200",
    OTEL_BLRP_EXPORT_TIMEOUT: "30000",
    OTEL_METRIC_EXPORT_INTERVAL: "5000",
    OTEL_METRIC_EXPORT_TIMEOUT: "10000",
    OTEL_LOG_LEVEL: "error",
    DEMO_UNIFIED_RUN_TOKEN: runToken,
    DEMO_UNIFIED_METRIC_NAME: metricName,
    GATEWAY_PORT: String(gatewayPort),
    CHECKOUT_PORT: String(checkoutPort),
  };
}

function startService(serviceName, sourceFile, runToken, metricName) {
  const child = spawn(
    process.execPath,
    [
      "--experimental-loader=@opentelemetry/instrumentation/hook.mjs",
      "--import",
      "@opentelemetry/auto-instrumentations-node/register",
      path.join(demoRoot, "src", sourceFile),
    ],
    {
      cwd: demoRoot,
      env: serviceEnvironment(serviceName, runToken, metricName),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);

  const output = [];
  let ready = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timeout = setTimeout(() => {
    rejectReady(
      new Error(serviceName + " did not report readiness within 30 seconds."),
    );
  }, 30_000);

  function observe(line, channel) {
    output.push(channel + ": " + line);
    console.log("[" + serviceName + "] " + channel + ": " + line);

    try {
      const record = JSON.parse(line);
      if (record.event === "demo_service_started") {
        ready = true;
        clearTimeout(timeout);
        resolveReady();
      }
    } catch {
      // SDK diagnostics remain in the captured output.
    }
  }

  createInterface({ input: child.stdout }).on("line", (line) => {
    observe(line, "stdout");
  });
  createInterface({ input: child.stderr }).on("line", (line) => {
    observe(line, "stderr");
  });

  child.once("error", (error) => {
    clearTimeout(timeout);
    rejectReady(error);
  });
  child.once("exit", (code, signal) => {
    if (!ready) {
      clearTimeout(timeout);
      rejectReady(
        new Error(
          serviceName +
            " exited before readiness (code=" +
            String(code) +
            ", signal=" +
            String(signal) +
            ").\n" +
            output.join("\n"),
        ),
      );
    }
  });

  return { child, ready: readyPromise, output };
}

async function stopService(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    delay(5_000).then(() => false),
  ]);

  if (!graceful && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function invokeFailure() {
  const response = await fetch(
    "http://127.0.0.1:" + gatewayPort + "/demo?mode=error",
  );
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.mode, "error");
  assert.match(body.traceId, /^[0-9a-f]{32}$/);
  return body.traceId;
}

function flattenTrace(nodes) {
  const flattened = [];
  for (const node of nodes) {
    flattened.push(node, ...flattenTrace(node.children ?? []));
  }
  return flattened;
}

async function waitForTrace(traceId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      backendUrl + "/v1/traces/" + encodeURIComponent(traceId),
    );
    if (response.ok) {
      const tree = await response.json();
      const spans = flattenTrace(tree);
      if (spans.length >= 3) return { tree, spans };
    }
    await delay(250);
  }
  throw new Error("Trace " + traceId + " was not stored within 60 seconds.");
}

async function waitForLog(traceId, spanId, runToken) {
  const message = "Phase 7 checkout inventory failure " + runToken;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const url = new URL("/v1/logs", backendUrl);
    url.searchParams.set("traceId", traceId);
    url.searchParams.set("service", "demo-checkout");
    url.searchParams.set("level", "error");
    const response = await fetch(url);
    if (response.ok) {
      const body = await response.json();
      const matches = (body.data ?? []).filter(
        (entry) => entry.message === message,
      );
      if (matches.length > 0) {
        assert.equal(matches.length, 1);
        assert.equal(matches[0].traceId, traceId);
        assert.equal(matches[0].spanId, spanId);
        assert.equal(matches[0].environment, "phase7");
        assert.equal(
          matches[0].metadata?.otel?.resourceAttributes?.["demo.run_token"],
          runToken,
        );
        return matches[0];
      }
    }
    await delay(250);
  }
  throw new Error("The correlated checkout log was not stored within 60 seconds.");
}

async function waitForMetric(metricName, runToken) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const url = new URL("/v1/metrics", backendUrl);
    url.searchParams.set("service", "demo-checkout");
    url.searchParams.set("name", metricName);
    url.searchParams.set("limit", "100");
    const response = await fetch(url);
    if (response.ok) {
      const body = await response.json();
      const matches = (body.data ?? []).filter(
        (entry) =>
          entry.metadata?.otel?.resourceAttributes?.["demo.run_token"] ===
          runToken,
      );
      if (matches.length > 0) {
        assert.equal(matches.every((entry) => entry.type === "counter"), true);
        assert.equal(matches.every((entry) => entry.value === 1), true);
        return matches;
      }
    }
    await delay(250);
  }
  throw new Error("The checkout failure counter was not stored within 60 seconds.");
}

async function waitForAlert(ruleId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const alerts = await requestJson("/v1/alerts");
    const alert = alerts.find((entry) => entry.ruleId === ruleId);
    if (alert !== undefined) return alert;
    await delay(250);
  }
  throw new Error("No alert was created for rule " + ruleId + ".");
}

function oneByService(values, service) {
  const matches = values.filter((value) => value.service === service);
  assert.equal(matches.length, 1, "Expected one entry for " + service + ".");
  return matches[0];
}

function traceWindow(spans, log, metrics) {
  const times = [
    ...spans.flatMap((span) => [span.startTime, span.endTime]),
    log.timestamp,
    ...metrics.map((metric) => metric.timestamp),
  ].map((value) => new Date(value).getTime());
  assert.equal(times.every(Number.isFinite), true);
  return {
    from: new Date(Math.min(...times) - 1_000).toISOString(),
    to: new Date(Math.max(...times) + 1_000).toISOString(),
  };
}

function projectFacts(facts) {
  return {
    service: facts.service,
    failureFindingCount: facts.failureFindingCount,
    logErrorCount: facts.logErrorCount,
    traceErrorCount: facts.traceErrorCount,
    highestSeverity: facts.highestSeverity,
    correlationTypes: facts.correlationTypes,
    signalTypes: facts.signalTypes,
    supportDiversity: facts.supportDiversity,
    observedLeafErrorSpanCount: facts.observedLeafErrorSpanCount,
    observedErrorAncestorSpanCount: facts.observedErrorAncestorSpanCount,
  };
}

function verifyInvestigation(investigation, traceId, checkoutSpanId, metricName) {
  assert.deepEqual(
    [...investigation.summary.servicesInvolved].sort(),
    ["demo-checkout", "demo-gateway"],
  );
  assert.equal(investigation.summary.errorSpans, 3);
  assert.ok(investigation.summary.metricAnomalies >= 1);
  assert.equal(investigation.summary.logErrors, 1);
  assert.ok(
    investigation.logs.some(
      (entry) => entry.traceId === traceId && entry.spanId === checkoutSpanId,
    ),
  );
  assert.ok(
    investigation.metrics.some(
      (entry) => entry.name === metricName && entry.service === "demo-checkout",
    ),
  );
  assert.ok(
    investigation.correlations.some(
      (entry) =>
        entry.type === "same_span" &&
        entry.traceId === traceId &&
        entry.spanId === checkoutSpanId,
    ),
  );
  assert.ok(
    investigation.signals.some(
      (entry) => entry.type === "multi_signal_evidence",
    ),
  );
  assert.deepEqual(investigation.integrityIssues, []);

  const checkoutFacts = oneByService(
    investigation.causeCandidateFacts,
    "demo-checkout",
  );
  const gatewayFacts = oneByService(
    investigation.causeCandidateFacts,
    "demo-gateway",
  );
  const checkoutRank = oneByService(
    investigation.causeCandidateRanks,
    "demo-checkout",
  );
  const gatewayRank = oneByService(
    investigation.causeCandidateRanks,
    "demo-gateway",
  );

  assert.equal(checkoutFacts.highestSeverity, "high");
  assert.equal(gatewayFacts.highestSeverity, "high");
  assert.equal(checkoutFacts.logErrorCount, 1);
  assert.equal(checkoutFacts.traceErrorCount, 1);
  assert.equal(checkoutFacts.observedLeafErrorSpanCount, 1);
  assert.equal(gatewayFacts.observedErrorAncestorSpanCount, 2);
  assert.equal(checkoutRank.severityRank, gatewayRank.severityRank);
  assert.equal(checkoutRank.tracePosition, "observed_leaf_failure");
  assert.equal(gatewayRank.tracePosition, "error_ancestor");
  assert.deepEqual(INVESTIGATION_RANKING_DIMENSIONS, [
    "failure_severity",
    "trace_position",
    "support_diversity",
    "failure_finding_count",
  ]);

  const decision = compareInvestigationCauseCandidateRanks(
    checkoutRank,
    gatewayRank,
  );
  assert.deepEqual(decision, {
    order: -1,
    decisiveDimension: "trace_position",
    dimensionsTiedBeforeDecision: ["failure_severity"],
  });
  assert.equal(checkoutRank.rank, 1);
  assert.equal(gatewayRank.rank, 2);
  assert.equal(investigation.causeCandidateRanks[0]?.service, "demo-checkout");

  return { checkoutFacts, gatewayFacts, checkoutRank, gatewayRank, decision };
}

async function waitForDrainedGroups(redis) {
  const groups = [
    ["spans", "span-workers"],
    ["metrics", "metric_workers"],
    ["logs", "log-workers"],
  ];
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const states = await Promise.all(
      groups.map(async ([stream, group]) => {
        const pending = await redis.xPending(stream, group);
        const info = await redis.xInfoGroups(stream);
        const selected = info.find((entry) => entry.name === group);
        return {
          stream,
          group,
          pending: pending.pending,
          lag: selected?.lag ?? null,
        };
      }),
    );
    if (states.every((state) => state.pending === 0 && state.lag === 0)) {
      return states;
    }
    await delay(100);
  }

  throw new Error("Telemetry consumer groups did not drain within 15 seconds.");
}

async function matchingStreamEntries(redis, stream, runToken) {
  const entries = await redis.xRevRange(stream, "+", "-", { COUNT: 500 });
  return entries.filter((entry) => {
    try {
      const event = JSON.parse(entry.message.event);
      return (
        event.metadata?.otel?.resourceAttributes?.["demo.run_token"] ===
        runToken
      );
    } catch {
      return false;
    }
  });
}

async function deleteCreatedRule() {
  if (createdRuleId === undefined) return;
  const ruleId = createdRuleId;
  await requestJson(
    "/v1/alert-rules/" + encodeURIComponent(ruleId),
    { method: "DELETE" },
    204,
  );
  createdRuleId = undefined;
}

async function verify() {
  await requestJson("/health");
  const redis = createClient({ url: redisUrl });
  await redis.connect();

  try {
    const runToken = alphabeticToken();
    const metricName = "phase7_checkout_failures_" + runToken;
    const dlqBefore = await redis.xLen("dlq");
    const rule = await requestJson(
      "/v1/alert-rules",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Phase 7 unified OTLP investigation " + randomUUID(),
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
        }),
      },
      201,
    );
    createdRuleId = rule.id;

    const checkout = startService(
      "demo-checkout",
      "checkout.mjs",
      runToken,
      metricName,
    );
    await checkout.ready;
    const gateway = startService(
      "demo-gateway",
      "gateway.mjs",
      runToken,
      metricName,
    );
    await gateway.ready;

    const traceId = await invokeFailure();
    const { tree, spans } = await waitForTrace(traceId);
    assert.equal(spans.length, 3);
    assert.equal(spans.every((span) => span.status === "error"), true);
    const checkoutSpans = spans.filter(
      (span) => span.service === "demo-checkout",
    );
    assert.equal(checkoutSpans.length, 1);
    const checkoutSpan = checkoutSpans[0];
    assert.equal(checkoutSpan.children.length, 0);

    const [log, initialMetrics, alert] = await Promise.all([
      waitForLog(traceId, checkoutSpan.spanId, runToken),
      waitForMetric(metricName, runToken),
      waitForAlert(rule.id),
    ]);
    await Promise.all(
      [...children].reverse().map((child) => stopService(child)),
    );
    const drainedGroups = await waitForDrainedGroups(redis);
    const metrics = await waitForMetric(metricName, runToken);
    assert.ok(metrics.length >= initialMetrics.length);
    const window = traceWindow(spans, log, metrics);

    await requestJson(
      "/v1/alerts/" + encodeURIComponent(alert.id) + "/investigation/window",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(window),
      },
    );
    const investigation = await requestJson(
      "/v1/alerts/" + encodeURIComponent(alert.id) + "/investigation",
    );
    const ranking = verifyInvestigation(
      investigation,
      traceId,
      checkoutSpan.spanId,
      metricName,
    );

    const [spanEntries, metricEntries, logEntries] = await Promise.all([
      matchingStreamEntries(redis, "spans", runToken),
      matchingStreamEntries(redis, "metrics", runToken),
      matchingStreamEntries(redis, "logs", runToken),
    ]);
    assert.equal(spanEntries.length, 3);
    assert.ok(metricEntries.length >= metrics.length);
    assert.equal(logEntries.length, 1);
    const dlqAfter = await redis.xLen("dlq");
    assert.equal(dlqAfter, dlqBefore);

    const result = {
      event: "otel_http_json_unified_investigation_verified",
      phase: "7B",
      protocol,
      compression,
      runToken,
      traceId,
      checkoutSpanId: checkoutSpan.spanId,
      storedSpanCount: spans.length,
      storedFailureMetricSamples: metrics.length,
      storedCorrelatedErrorLogs: 1,
      alertId: alert.id,
      ruleId: rule.id,
      window,
      summary: investigation.summary,
      checkoutFacts: projectFacts(ranking.checkoutFacts),
      gatewayFacts: projectFacts(ranking.gatewayFacts),
      rankingDecision: ranking.decision,
      ranks: investigation.causeCandidateRanks,
      drainedGroups,
      streamEntries: {
        spans: spanEntries.length,
        metrics: metricEntries.length,
        logs: logEntries.length,
      },
      newDlqEntries: dlqAfter - dlqBefore,
      preserved: preserveInvestigation,
      frontendUrl:
        "http://localhost:5173/investigations/" + encodeURIComponent(alert.id),
      traceTreeRoots: tree.length,
    };

    console.log(JSON.stringify(result, null, 2));

    if (!preserveInvestigation) {
      await deleteCreatedRule();
    }

    return result;
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}

let verificationError;
try {
  await verify();
} catch (error) {
  verificationError = error;
} finally {
  await Promise.allSettled(
    [...children].reverse().map((child) => stopService(child)),
  );
}

if (verificationError !== undefined) {
  try {
    await deleteCreatedRule();
  } catch (cleanupError) {
    throw new AggregateError(
      [verificationError, cleanupError],
      "Unified verification and rule cleanup both failed.",
    );
  }
  throw verificationError;
}
