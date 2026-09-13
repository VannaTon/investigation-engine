import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import http from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createClient } from "redis";

const demoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const backendUrl =
  process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const redisUrl =
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const logEndpoint = backendUrl + "/otlp/v1/logs";
const protocol = "http/json";
const exportTimeoutMs = 60_000;
const persistenceTimeoutMs = 60_000;

function alphabeticToken(length = 20) {
  return [...randomBytes(length)]
    .map((value) => String.fromCharCode(97 + (value % 26)))
    .join("");
}

function messagesFor(runToken) {
  return {
    info: "Phase 6C info " + runToken,
    error: "Phase 6C checkout failure " + runToken,
    stack:
      "CheckoutError: inventory unavailable " +
      runToken +
      "\n    at checkout (runtime-logs.mjs:1:1)",
  };
}

function decodeAnyValue(value) {
  if (value == null || typeof value !== "object") {
    return undefined;
  }
  if ("stringValue" in value) return value.stringValue;
  if ("boolValue" in value) return value.boolValue;
  if ("intValue" in value) return value.intValue;
  if ("doubleValue" in value) return value.doubleValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("arrayValue" in value) {
    return (value.arrayValue?.values ?? []).map(decodeAnyValue);
  }
  if ("kvlistValue" in value) {
    return attributesMap(value.kvlistValue?.values ?? []);
  }
  return undefined;
}

function attributesMap(attributes) {
  return Object.fromEntries(
    (attributes ?? []).map((attribute) => [
      attribute.key,
      decodeAnyValue(attribute.value),
    ]),
  );
}

function flattenLogRecords(request) {
  return (request.resourceLogs ?? []).flatMap((resourceLogs) =>
    (resourceLogs.scopeLogs ?? []).flatMap((scopeLogs) =>
      (scopeLogs.logRecords ?? []).map((logRecord) => ({
        resourceLogs,
        scopeLogs,
        logRecord,
      })),
    ),
  );
}

function verifyExporterEnvelope(request, service, runToken) {
  const records = flattenLogRecords(request);
  const messages = messagesFor(runToken);

  assert.equal(records.length, 2);

  for (const entry of records) {
    const resourceAttributes = attributesMap(
      entry.resourceLogs.resource?.attributes,
    );
    assert.equal(resourceAttributes["service.name"], service);
    assert.equal(
      resourceAttributes["deployment.environment.name"],
      "phase6c",
    );
    assert.equal(entry.scopeLogs.scope?.name, "otel-http-json-demo-logger");
    assert.equal(entry.scopeLogs.scope?.version, "1.0.0");
  }

  const byBody = new Map(
    records.map((entry) => [
      decodeAnyValue(entry.logRecord.body),
      entry.logRecord,
    ]),
  );
  const info = byBody.get(messages.info);
  const error = byBody.get(messages.error);

  assert.ok(info, "Official exporter omitted the INFO record.");
  assert.ok(error, "Official exporter omitted the ERROR record.");
  assert.equal(info.severityNumber, 9);
  assert.equal(info.severityText, "INFO");
  assert.equal(info.eventName, "phase6c.demo.info");
  assert.equal(error.severityNumber, 17);
  assert.equal(error.severityText, "ERROR");
  assert.equal(error.eventName, "phase6c.demo.error");

  const infoAttributes = attributesMap(info.attributes);
  const errorAttributes = attributesMap(error.attributes);

  assert.equal(infoAttributes["demo.run_token"], runToken);
  assert.equal(infoAttributes["demo.record_kind"], "info");
  assert.deepEqual(infoAttributes["demo.nested"], {
    verified: true,
    sequence: 1,
  });
  assert.equal(errorAttributes["demo.run_token"], runToken);
  assert.equal(errorAttributes["demo.record_kind"], "error");
  assert.deepEqual(errorAttributes["demo.nested"], {
    verified: true,
    sequence: 2,
  });
  assert.equal(errorAttributes["exception.stacktrace"], messages.stack);

  return records;
}

async function stopChild(child) {
  if (
    child === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }

  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
  });

  child.kill("SIGTERM");

  const graceful = await Promise.race([
    exited.then(() => true),
    delay(5_000, undefined, { ref: false }).then(() => false),
  ]);

  if (
    !graceful &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function closeServer(server) {
  if (!server.listening) return;

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function childEnvironment(service, runToken, endpoint, compression) {
  return {
    ...process.env,
    OTEL_SERVICE_NAME: service,
    OTEL_RESOURCE_ATTRIBUTES:
      "deployment.environment.name=phase6c,demo.run_token=" + runToken,
    OTEL_TRACES_EXPORTER: "none",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: protocol,
    OTEL_EXPORTER_OTLP_LOGS_COMPRESSION: compression,
    OTEL_NODE_ENABLED_INSTRUMENTATIONS: "http",
    OTEL_NODE_RESOURCE_DETECTORS: "env,process",
    OTEL_BLRP_SCHEDULE_DELAY: "200",
    OTEL_BLRP_EXPORT_TIMEOUT: "30000",
    OTEL_LOG_LEVEL: "warn",
    DEMO_LOG_RUN_TOKEN: runToken,
  };
}

function observeChild(child, service, runToken) {
  const output = [];
  let started = false;

  function observe(line, channel) {
    output.push(channel + ": " + line);

    try {
      const record = JSON.parse(line);

      if (
        record.event === "runtime_logs_demo_started" &&
        record.service === service &&
        record.runToken === runToken
      ) {
        started = true;
      }
    } catch {
      // SDK diagnostics remain available as captured plain text.
    }
  }

  createInterface({ input: child.stdout }).on("line", (line) => {
    observe(line, "stdout");
  });
  createInterface({ input: child.stderr }).on("line", (line) => {
    observe(line, "stderr");
  });

  return {
    output,
    wasStarted: () => started,
  };
}

async function runExporter(compression, service, runToken) {
  const observedRequests = [];
  const proxyErrors = [];
  let firstRequestResolve;
  let firstRequestReject;
  let inFlight = 0;
  const firstRequest = new Promise((resolve, reject) => {
    firstRequestResolve = resolve;
    firstRequestReject = reject;
  });
  const proxy = http.createServer(async (request, response) => {
    inFlight++;

    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/otlp/v1/logs");
      assert.match(
        request.headers["content-type"] ?? "",
        /^application\/json(?:;|$)/,
      );

      const chunks = [];

      for await (const chunk of request) chunks.push(chunk);

      const encodedBody = Buffer.concat(chunks);
      const contentEncoding = request.headers["content-encoding"];
      const decodedBody =
        contentEncoding === "gzip"
          ? gunzipSync(encodedBody)
          : encodedBody;
      const parsed = JSON.parse(decodedBody.toString("utf8"));
      const records = verifyExporterEnvelope(
        parsed,
        service,
        runToken,
      );

      if (compression === "gzip") {
        assert.equal(contentEncoding, "gzip");
        assert.ok(encodedBody.length < decodedBody.length);
      } else {
        assert.equal(contentEncoding, undefined);
      }

      const headers = {
        "content-type": request.headers["content-type"],
      };

      if (contentEncoding !== undefined) {
        headers["content-encoding"] = contentEncoding;
      }

      const upstream = await fetch(logEndpoint, {
        method: "POST",
        headers,
        body: encodedBody,
      });
      const responseText = await upstream.text();
      const responseBody = JSON.parse(responseText);

      assert.equal(upstream.status, 200);
      assert.deepEqual(responseBody, {});

      observedRequests.push({
        compressedBytes: encodedBody.length,
        decompressedBytes: decodedBody.length,
        logRecords: records.length,
        status: upstream.status,
      });

      response.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") ??
          "application/json",
      });
      response.end(responseText);
      firstRequestResolve();
    } catch (error) {
      proxyErrors.push(error);
      response.writeHead(502, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          message: "Phase 6C forwarding probe failed.",
        }),
      );
      firstRequestReject(error);
    } finally {
      inFlight--;
    }
  });

  let child;
  let observation;

  try {
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });

    const address = proxy.address();
    assert.ok(address && typeof address === "object");
    const endpoint =
      "http://127.0.0.1:" + address.port + "/otlp/v1/logs";

    child = spawn(
      process.execPath,
      [
        "--import",
        "@opentelemetry/auto-instrumentations-node/register",
        path.join(demoRoot, "src", "runtime-logs.mjs"),
      ],
      {
        cwd: demoRoot,
        env: childEnvironment(
          service,
          runToken,
          endpoint,
          compression,
        ),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    observation = observeChild(child, service, runToken);

    const earlyExit = new Promise((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (observedRequests.length === 0) {
          reject(
            new Error(
              "Log process exited before exporting " +
                "(code=" +
                code +
                ", signal=" +
                signal +
                ").\n" +
                observation.output.join("\n"),
            ),
          );
        }
      });
    });

    await Promise.race([
      firstRequest,
      earlyExit,
      delay(exportTimeoutMs, undefined, { ref: false }).then(() => {
        throw new Error(
          "No OTLP log export arrived within " +
            exportTimeoutMs +
            " ms.",
        );
      }),
    ]);

    await stopChild(child);

    const inFlightDeadline = Date.now() + 10_000;

    while (inFlight > 0 && Date.now() < inFlightDeadline) {
      await delay(50);
    }

    assert.equal(inFlight, 0);
    assert.deepEqual(proxyErrors, []);
    assert.equal(observation.wasStarted(), true);
    assert.equal(observedRequests.length, 1);

    return {
      compression,
      service,
      runToken,
      request: observedRequests[0],
      exporterDiagnostics: observation.output.filter((line) =>
        /error|warn|fail/i.test(line),
      ),
    };
  } finally {
    await stopChild(child);
    await closeServer(proxy);
  }
}

async function requireBackend() {
  const health = await fetch(backendUrl + "/health");
  assert.equal(
    health.ok,
    true,
    "Backend health returned HTTP " + health.status,
  );

  const empty = await fetch(logEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {});
}

async function loadStoredLogs(service, runToken) {
  const deadline = Date.now() + persistenceTimeoutMs;
  let logs = [];

  while (Date.now() < deadline) {
    const url = new URL("/v1/logs", backendUrl);
    url.searchParams.set("service", service);
    url.searchParams.set("search", runToken);
    url.searchParams.set("limit", "10");
    const response = await fetch(url);

    assert.equal(response.ok, true);
    const body = await response.json();
    logs = Array.isArray(body.data) ? body.data : [];

    if (logs.length >= 2) break;
    await delay(250);
  }

  assert.equal(logs.length, 2);
  return logs;
}

function verifyStoredLogs(logs, service, runToken) {
  const messages = messagesFor(runToken);
  const byMessage = new Map(logs.map((log) => [log.message, log]));
  const info = byMessage.get(messages.info);
  const error = byMessage.get(messages.error);

  assert.ok(info);
  assert.ok(error);
  assert.equal(info.service, service);
  assert.equal(error.service, service);
  assert.equal(info.level, "info");
  assert.equal(error.level, "error");
  assert.equal(info.environment, "phase6c");
  assert.equal(error.environment, "phase6c");
  assert.equal(error.stackTrace, messages.stack);
  assert.equal(info.traceId, undefined);
  assert.equal(error.traceId, undefined);

  for (const log of [info, error]) {
    const otel = log.metadata?.otel;
    assert.equal(otel?.resourceAttributes?.["service.name"], service);
    assert.equal(
      otel?.resourceAttributes?.["deployment.environment.name"],
      "phase6c",
    );
    assert.equal(otel?.scope?.name, "otel-http-json-demo-logger");
    assert.equal(otel?.scope?.version, "1.0.0");
    assert.equal(otel?.logAttributes?.["demo.run_token"], runToken);
    assert.equal(otel?.bodyType, "stringValue");
    assert.equal(otel?.selectedTimestampField, "timeUnixNano");
    assert.match(otel?.timeUnixNano ?? "", /^\d+$/);
  }

  assert.equal(info.metadata.otel.severityNumber, 9);
  assert.equal(info.metadata.otel.eventName, "phase6c.demo.info");
  assert.deepEqual(info.metadata.otel.logAttributes["demo.nested"], {
    sequence: 1,
    verified: true,
  });
  assert.equal(error.metadata.otel.severityNumber, 17);
  assert.equal(error.metadata.otel.eventName, "phase6c.demo.error");
  assert.deepEqual(error.metadata.otel.logAttributes["demo.nested"], {
    sequence: 2,
    verified: true,
  });
}

async function loadErrorGroup(errorMessage) {
  const deadline = Date.now() + persistenceTimeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(backendUrl + "/v1/errors/groups");
    assert.equal(response.ok, true);
    const groups = await response.json();
    const matches = groups.filter(
      (group) => group.sample_message === errorMessage,
    );

    if (matches.length > 0) {
      assert.equal(matches.length, 1);
      return matches[0];
    }

    await delay(250);
  }

  throw new Error("The Phase 6C error group was not created.");
}

async function verifyInvestigation(group, service, errorMessage) {
  assert.equal(Number(group.occurrence_count), 1);
  assert.equal(group.example_trace_id, null);

  const response = await fetch(
    backendUrl +
      "/v1/investigations/" +
      encodeURIComponent(group.fingerprint),
  );
  assert.equal(response.ok, true);
  const investigation = await response.json();

  assert.equal(investigation.group.fingerprint, group.fingerprint);
  assert.equal(investigation.logs.data.length, 1);
  assert.equal(investigation.logs.data[0].message, errorMessage);
  assert.equal(investigation.logs.data[0].service, service);
  assert.deepEqual(investigation.traces, []);
  assert.deepEqual(investigation.metrics, []);
}

async function loadRedisMessages(client, service) {
  const deadline = Date.now() + persistenceTimeoutMs;

  while (Date.now() < deadline) {
    const recent = await client.xRevRange("logs", "+", "-", {
      COUNT: 100,
    });
    const matches = recent.filter((entry) => {
      try {
        return JSON.parse(entry.message.event).service === service;
      } catch {
        return false;
      }
    });

    if (matches.length >= 2) {
      assert.equal(matches.length, 2);
      return matches;
    }

    await delay(250);
  }

  throw new Error("Phase 6C log messages were not found in Redis.");
}

async function requireLogWorker(client) {
  try {
    await client.xPending("logs", "log-workers");
  } catch (error) {
    throw new Error(
      "The log worker consumer group is unavailable. Start it with npm run worker. " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

async function verifyAcknowledged(client, messages) {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const pending = await Promise.all(
      messages.map((entry) =>
        client.xPendingRange(
          "logs",
          "log-workers",
          entry.id,
          entry.id,
          1,
        ),
      ),
    );

    if (pending.every((entries) => entries.length === 0)) return;
    await delay(100);
  }

  assert.fail("A Phase 6C Redis message remains pending.");
}

async function verifyNoExistingGroup(errorMessage) {
  const response = await fetch(backendUrl + "/v1/errors/groups");
  assert.equal(response.ok, true);
  const groups = await response.json();
  assert.equal(
    groups.some((group) => group.sample_message === errorMessage),
    false,
    "The supposedly unique Phase 6C error group already exists.",
  );
}

async function main() {
  assert.equal(protocol, "http/json");
  await requireBackend();

  const redis = createClient({ url: redisUrl });
  const results = [];

  try {
    await redis.connect();
    await requireLogWorker(redis);

    for (const compression of ["none", "gzip"]) {
      const runToken = alphabeticToken();
      const service =
        "otel-log-demo-" + compression + "-" + runToken;
      const messages = messagesFor(runToken);

      await verifyNoExistingGroup(messages.error);
      const exportResult = await runExporter(
        compression,
        service,
        runToken,
      );
      const storedLogs = await loadStoredLogs(service, runToken);
      verifyStoredLogs(storedLogs, service, runToken);
      const group = await loadErrorGroup(messages.error);
      await verifyInvestigation(group, service, messages.error);
      const redisMessages = await loadRedisMessages(redis, service);
      await verifyAcknowledged(redis, redisMessages);

      results.push({
        ...exportResult,
        storedLogs: storedLogs.length,
        errorGroupFingerprint: group.fingerprint,
        investigationLogs: 1,
        pendingVerifierMessages: 0,
      });
    }
  } finally {
    if (redis.isOpen) await redis.quit();
  }

  console.log(
    JSON.stringify({
      event: "otel_http_json_logs_demo_verified",
      protocol,
      ordinaryStoredLogs: results[0].storedLogs,
      gzipStoredLogs: results[1].storedLogs,
      errorGroups: results.length,
      pendingVerifierMessages: results.reduce(
        (total, result) =>
          total + result.pendingVerifierMessages,
        0,
      ),
      results,
    }),
  );
}

await main();
