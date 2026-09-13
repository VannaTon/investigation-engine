import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "redis";

const demoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const gatewayPort = Number(process.env.GATEWAY_PORT ?? 41_001);
const checkoutPort = Number(process.env.CHECKOUT_PORT ?? 41_002);
const traceEndpoint = backendUrl + "/v1/traces";
const protocol = "http/json";
const compression = "none";
const children = [];

assert.equal(protocol, "http/json");
assert.equal(compression, "none");

function serviceEnvironment(serviceName) {
  return {
    ...process.env,
    OTEL_SERVICE_NAME: serviceName,
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: traceEndpoint,
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: protocol,
    OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: compression,
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "none",
    OTEL_PROPAGATORS: "tracecontext,baggage",
    OTEL_TRACES_SAMPLER: "always_on",
    OTEL_NODE_ENABLED_INSTRUMENTATIONS: "http",
    OTEL_NODE_RESOURCE_DETECTORS: "env,process",
    OTEL_BSP_SCHEDULE_DELAY: "200",
    OTEL_BSP_EXPORT_TIMEOUT: "30000",
    OTEL_LOG_LEVEL: "error",
    GATEWAY_PORT: String(gatewayPort),
    CHECKOUT_PORT: String(checkoutPort),
  };
}

function startService(serviceName, sourceFile) {
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
      env: serviceEnvironment(serviceName),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);

  const logs = [];
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

  function observeLine(line, channel) {
    const entry = channel + ": " + line;
    logs.push(entry);
    console.log("[" + serviceName + "] " + entry);

    try {
      const parsed = JSON.parse(line);

      if (parsed.event === "demo_service_started") {
        ready = true;
        clearTimeout(timeout);
        resolveReady();
      }
    } catch {
      // OpenTelemetry may emit non-JSON diagnostics. They remain in captured logs.
    }
  }

  createInterface({ input: child.stdout }).on("line", (line) => {
    observeLine(line, "stdout");
  });
  createInterface({ input: child.stderr }).on("line", (line) => {
    observeLine(line, "stderr");
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
            logs.join("\n"),
        ),
      );
    }
  });

  return { child, ready: readyPromise, logs };
}

async function stopService(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
  });
  child.kill("SIGTERM");

  const completed = await Promise.race([
    exited.then(() => true),
    delay(5_000).then(() => false),
  ]);

  if (!completed && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function requireBackend() {
  let response;

  try {
    response = await fetch(backendUrl + "/health");
  } catch (error) {
    throw new Error(
      "Backend is not reachable at " +
        backendUrl +
        ": " +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  assert.equal(
    response.ok,
    true,
    "Backend health endpoint returned HTTP " + response.status + ".",
  );
}

async function invokeDemo(mode, expectedStatus) {
  const response = await fetch(
    "http://127.0.0.1:" +
      gatewayPort +
      "/demo?mode=" +
      encodeURIComponent(mode),
  );
  const body = await response.json();

  assert.equal(response.status, expectedStatus);
  assert.equal(body.mode, mode);
  assert.match(body.traceId, /^[0-9a-f]{32}$/);

  return body.traceId;
}

async function loadTrace(traceId) {
  const deadline = Date.now() + 60_000;
  let lastStatus = 0;
  let lastSpanCount = 0;

  while (Date.now() < deadline) {
    const response = await fetch(
      backendUrl + "/v1/traces/" + encodeURIComponent(traceId),
    );
    lastStatus = response.status;

    if (response.ok) {
      const trace = await response.json();

      if (Array.isArray(trace)) {
        lastSpanCount = flattenTrace(trace).length;
      }

      if (Array.isArray(trace) && lastSpanCount >= 3) {
        return trace;
      }
    }

    await delay(250);
  }

  throw new Error(
    "Trace " +
      traceId +
      " did not reach three spans within 60 seconds; last HTTP status was " +
      lastStatus +
      ", last span count was " +
      lastSpanCount +
      ".",
  );
}

function flattenTrace(nodes) {
  const flattened = [];

  for (const node of nodes) {
    flattened.push(node);
    flattened.push(...flattenTrace(node.children ?? []));
  }

  return flattened;
}

function verifyTrace(traceTree, traceId, expectError) {
  const spans = flattenTrace(traceTree);
  assert.ok(spans.length >= 3, "Expected at least three HTTP spans.");

  const services = new Set(spans.map((span) => span.service));
  assert.ok(services.has("demo-gateway"));
  assert.ok(services.has("demo-checkout"));

  const spansById = new Map(spans.map((span) => [span.spanId, span]));

  for (const span of spans) {
    assert.equal(span.traceId, traceId);
    assert.match(span.spanId, /^[0-9a-f]{16}$/);
    assert.ok(Number.isInteger(span.durationMs));
    assert.ok(span.durationMs >= 0);
    assert.ok(span.durationMs <= 4_294_967_295);
    assert.ok(span.status === "ok" || span.status === "error");
    assert.equal(
      span.metadata?.otel?.resourceAttributes?.["service.name"],
      span.service,
    );
    assert.equal(
      typeof span.metadata?.otel?.spanAttributes,
      "object",
    );
  }

  const hasCrossServiceEdge = spans.some((span) => {
    if (span.service !== "demo-checkout" || !span.parentSpanId) {
      return false;
    }

    return spansById.get(span.parentSpanId)?.service === "demo-gateway";
  });
  assert.equal(
    hasCrossServiceEdge,
    true,
    "Expected checkout to be a descendant of a gateway span.",
  );

  if (expectError) {
    assert.equal(
      spans.some(
        (span) =>
          span.service === "demo-checkout" && span.status === "error",
      ),
      true,
      "Expected the failing checkout request to produce an error span.",
    );
  } else {
    assert.equal(
      spans.every((span) => span.status === "ok"),
      true,
      "Expected the successful trace to contain only ok spans.",
    );
  }

  return spans;
}

async function waitForNoPendingMessages() {
  const client = createClient({ url: redisUrl });

  try {
    await client.connect();
    const deadline = Date.now() + 5_000;
    let pending = await client.xPending("spans", "span-workers");

    while (pending.pending !== 0 && Date.now() < deadline) {
      await delay(100);
      pending = await client.xPending("spans", "span-workers");
    }

    assert.equal(
      pending.pending,
      0,
      "The span worker consumer group still has pending messages.",
    );
  } finally {
    if (client.isOpen) {
      await client.quit();
    }
  }
}

async function main() {
  await requireBackend();

  const checkout = startService("demo-checkout", "checkout.mjs");
  await checkout.ready;
  const gateway = startService("demo-gateway", "gateway.mjs");
  await gateway.ready;

  const successTraceId = await invokeDemo("success", 200);
  const errorTraceId = await invokeDemo("error", 502);
  const successTrace = await loadTrace(successTraceId);
  const errorTrace = await loadTrace(errorTraceId);
  const successSpans = verifyTrace(successTrace, successTraceId, false);
  const errorSpans = verifyTrace(errorTrace, errorTraceId, true);

  await waitForNoPendingMessages();

  console.log(
    JSON.stringify({
      event: "otel_http_json_demo_verified",
      protocol,
      compression,
      successTraceId,
      successSpanCount: successSpans.length,
      errorTraceId,
      errorSpanCount: errorSpans.length,
      pendingMessages: 0,
    }),
  );
}

try {
  await main();
} finally {
  await Promise.allSettled(
    [...children].reverse().map((child) => stopService(child)),
  );
}
