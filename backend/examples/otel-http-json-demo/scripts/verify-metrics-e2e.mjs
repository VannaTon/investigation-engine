import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
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
const metricEndpoint = backendUrl + "/otlp/v1/metrics";
const protocol = "http/json";
const exportIntervalMs = 1_000;
const firstExportTimeoutMs = 60_000;
const persistenceTimeoutMs = 300_000;

function metricKind(metric) {
  return [
    "gauge",
    "sum",
    "histogram",
    "exponentialHistogram",
    "summary",
  ].find((kind) => metric[kind] != null);
}

function dataPointCount(metric, kind) {
  return Array.isArray(metric[kind]?.dataPoints)
    ? metric[kind].dataPoints.length
    : 0;
}

function acceptedEventType(metric, kind) {
  if (kind === "gauge") {
    return "gauge";
  }

  if (
    kind === "sum" &&
    metric.sum?.aggregationTemporality === 2 &&
    metric.sum?.isMonotonic === true
  ) {
    return "counter";
  }

  if (
    kind === "histogram" &&
    (metric.histogram?.aggregationTemporality === 1 ||
      metric.histogram?.aggregationTemporality === 2)
  ) {
    return "histogram";
  }
}

function serviceNameFromRequest(request) {
  return request.resourceMetrics?.[0]?.resource?.attributes?.find(
    (attribute) => attribute.key === "service.name",
  )?.value?.stringValue;
}

function flattenMetrics(request) {
  return (request.resourceMetrics ?? []).flatMap((resource) =>
    (resource.scopeMetrics ?? []).flatMap(
      (scope) => scope.metrics ?? [],
    ),
  );
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
    delay(5_000).then(() => false),
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
  if (!server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function observeChild(child, service) {
  const output = [];
  let started = false;

  function observe(line, channel) {
    output.push(channel + ": " + line);

    try {
      const record = JSON.parse(line);

      if (
        record.event === "runtime_metrics_demo_started" &&
        record.service === service
      ) {
        started = true;
      }
    } catch {
      // SDK diagnostics are retained as plain text.
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

function childEnvironment(service, endpoint, compression) {
  return {
    ...process.env,
    OTEL_SERVICE_NAME: service,
    OTEL_TRACES_EXPORTER: "none",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "none",
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: protocol,
    OTEL_EXPORTER_OTLP_METRICS_COMPRESSION: compression,
    OTEL_NODE_ENABLED_INSTRUMENTATIONS: "runtime-node",
    OTEL_NODE_RESOURCE_DETECTORS: "env,process",
    OTEL_METRIC_EXPORT_INTERVAL: String(exportIntervalMs),
    OTEL_METRIC_EXPORT_TIMEOUT: "10000",
    OTEL_LOG_LEVEL: "warn",
  };
}

async function requireBackend() {
  const health = await fetch(backendUrl + "/health");
  assert.equal(
    health.ok,
    true,
    "Backend health returned HTTP " + health.status,
  );

  const empty = await fetch(metricEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {});
}

async function requireNoRuleCollision(services) {
  const response = await fetch(backendUrl + "/v1/alert-rules");
  assert.equal(response.ok, true);

  const rules = await response.json();
  assert.ok(Array.isArray(rules));

  for (const service of services) {
    assert.equal(
      rules.some(
        (rule) =>
          rule.enabled === true &&
          rule.type === "metric_threshold" &&
          rule.config?.service === service,
      ),
      false,
      "Diagnostic service unexpectedly matches an alert rule",
    );
  }
}

async function runExporter(compression, service) {
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
      const chunks = [];

      for await (const chunk of request) {
        chunks.push(chunk);
      }

      const encodedBody = Buffer.concat(chunks);
      const contentEncoding = request.headers["content-encoding"];
      const decodedBody =
        contentEncoding === "gzip"
          ? gunzipSync(encodedBody)
          : encodedBody;
      const parsed = JSON.parse(decodedBody.toString("utf8"));
      const metrics = flattenMetrics(parsed);
      const kinds = metrics.map((metric) => {
        const kind = metricKind(metric);
        assert.ok(kind, "Exporter emitted an unknown metric kind");

        return {
          name: metric.name,
          kind,
          points: dataPointCount(metric, kind),
          eventType: acceptedEventType(metric, kind),
          aggregationTemporality: metric[kind]?.aggregationTemporality,
          isMonotonic: metric[kind]?.isMonotonic,
          startTimes: (metric[kind]?.dataPoints ?? []).map(
            (point) => point.startTimeUnixNano,
          ),
        };
      });
      const gaugePoints = kinds
        .filter((metric) => metric.eventType === "gauge")
        .reduce((total, metric) => total + metric.points, 0);
      const counterPoints = kinds
        .filter((metric) => metric.eventType === "counter")
        .reduce((total, metric) => total + metric.points, 0);
      const histogramPoints = kinds
        .filter((metric) => metric.eventType === "histogram")
        .reduce((total, metric) => total + metric.points, 0);
      const unsupportedPoints = kinds
        .filter((metric) => metric.eventType === undefined)
        .reduce((total, metric) => total + metric.points, 0);

      assert.equal(serviceNameFromRequest(parsed), service);
      assert.ok(gaugePoints > 0);
      assert.ok(counterPoints > 0);
      assert.ok(unsupportedPoints > 0);

      if (compression === "gzip") {
        assert.equal(contentEncoding, "gzip");
        assert.ok(encodedBody.length < decodedBody.length);
      } else {
        assert.equal(contentEncoding, undefined);
      }

      const headers = {
        "content-type":
          request.headers["content-type"] ?? "application/json",
      };

      if (contentEncoding !== undefined) {
        headers["content-encoding"] = contentEncoding;
      }

      const upstream = await fetch(metricEndpoint, {
        method: "POST",
        headers,
        body: encodedBody,
      });
      const responseText = await upstream.text();
      const responseBody = JSON.parse(responseText);

      assert.equal(upstream.status, 200);
      assert.equal(
        responseBody.partialSuccess?.rejectedDataPoints,
        String(unsupportedPoints),
        "Backend rejection count did not match classified exporter data: " +
          JSON.stringify({
            kinds,
            responseBody,
          }),
      );
      assert.match(
        responseBody.partialSuccess?.errorMessage ?? "",
        new RegExp("^Rejected " + unsupportedPoints + " invalid data point"),
      );

      observedRequests.push({
        compressedBytes: encodedBody.length,
        decompressedBytes: decodedBody.length,
        gaugePoints,
        counterPoints,
        histogramPoints,
        unsupportedPoints,
        metricNames: kinds.map((metric) => metric.name),
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
          message: "Phase 5F2 forwarding probe failed.",
        }),
      );
      firstRequestReject(error);
    } finally {
      inFlight--;
    }
  });

  let child;
  let childObservation;

  try {
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });

    const address = proxy.address();
    assert.ok(address && typeof address === "object");
    const proxyEndpoint =
      "http://127.0.0.1:" +
      address.port +
      "/otlp/v1/metrics";

    child = spawn(
      process.execPath,
      [
        "--expose-gc",
        "--import",
        "@opentelemetry/auto-instrumentations-node/register",
        path.join(demoRoot, "src", "runtime-metrics.mjs"),
      ],
      {
        cwd: demoRoot,
        env: childEnvironment(
          service,
          proxyEndpoint,
          compression,
        ),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    childObservation = observeChild(child, service);

    const earlyExit = new Promise((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (observedRequests.length === 0) {
          reject(
            new Error(
              "Runtime process exited before exporting metrics " +
                "(code=" +
                code +
                ", signal=" +
                signal +
                ").",
            ),
          );
        }
      });
    });

    await Promise.race([
      firstRequest,
      earlyExit,
      delay(firstExportTimeoutMs).then(() => {
        throw new Error(
          "No OTLP metrics export arrived within " +
            firstExportTimeoutMs +
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
    assert.equal(childObservation.wasStarted(), true);
    assert.ok(observedRequests.length >= 1);
    assert.ok(
      observedRequests.some((request) => request.histogramPoints > 0),
      "Official runtime instrumentation emitted no Histogram points",
    );



    const diagnostics = childObservation.output.filter((line) =>
      /error|warn|fail|partial/i.test(line),
    );
    assert.ok(
      diagnostics.some((line) =>
        line.includes("Received Partial Success response"),
      ),
      "Official exporter did not report the partial-success response",
    );

    return {
      compression,
      service,
      requests: observedRequests,
      exporterDiagnostics: diagnostics,
    };
  } finally {
    await stopChild(child);
    await closeServer(proxy);
  }
}

async function loadStoredMetrics(service, expectedCount) {
  const deadline = Date.now() + persistenceTimeoutMs;
  let lastStatus = 0;
  let data = [];

  while (Date.now() < deadline) {
    const url = new URL("/v1/metrics", backendUrl);
    url.searchParams.set("service", service);
    url.searchParams.set("limit", "200");

    const response = await fetch(url);
    lastStatus = response.status;

    if (response.ok) {
      const body = await response.json();
      data = Array.isArray(body.data) ? body.data : [];

      if (data.length >= expectedCount) {
        break;
      }
    }

    await delay(500);
  }

  assert.equal(
    data.length,
    expectedCount,
    "Expected " +
      expectedCount +
      " stored metrics for " +
      service +
      "; got " +
      data.length +
      " (last HTTP status " +
      lastStatus +
      ")",
  );

  return data;
}

function verifyStoredMetrics(
  metrics,
  service,
  expectedGaugeCount,
  expectedCounterCount,
) {
  assert.ok(metrics.length > 0);
  assert.equal(
    metrics.filter((metric) => metric.type === "gauge").length,
    expectedGaugeCount,
  );
  assert.equal(
    metrics.filter((metric) => metric.type === "counter").length,
    expectedCounterCount,
  );
  assert.ok(
    metrics.some(
      (metric) =>
        metric.name === "nodejs.eventloop.utilization" &&
        metric.unit === "1",
    ),
  );
  assert.ok(
    metrics.some(
      (metric) =>
        metric.name === "v8js.memory.heap.used" &&
        metric.unit === "By",
    ),
  );
  assert.ok(
    metrics.some(
      (metric) =>
        typeof metric.metadata?.otel?.dataPointAttributes?.[
          "v8js.heap.space.name"
        ] === "string",
    ),
  );
  assert.ok(
    metrics.some(
      (metric) =>
        metric.name === "nodejs.eventloop.time" &&
        metric.type === "counter",
    ),
  );
  assert.equal(
    metrics.some((metric) => metric.name === "v8js.memory.heap.space.size"),
    false,
  );
  assert.equal(
    metrics.some((metric) => metric.name === "v8js.gc.duration"),
    false,
  );

  for (const metric of metrics) {
    assert.equal(metric.service, service);
    assert.ok(metric.type === "gauge" || metric.type === "counter");
    assert.equal(Number.isFinite(metric.value), true);
    assert.match(
      metric.timestamp,
      /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    assert.equal(
      metric.metadata?.otel?.resourceAttributes?.[
        "service.name"
      ],
      service,
    );
    assert.equal(
      typeof metric.metadata?.otel?.scopeAttributes,
      "object",
    );
    assert.equal(
      typeof metric.metadata?.otel?.dataPointAttributes,
      "object",
    );
    assert.ok(
      metric.metadata?.otel?.valueType === "asDouble" ||
        metric.metadata?.otel?.valueType === "asInt",
    );

    if (metric.type === "counter") {
      assert.equal(metric.metadata?.otel?.metricDataKind, "sum");
      assert.equal(metric.metadata?.otel?.aggregationTemporality, 2);
      assert.equal(metric.metadata?.otel?.isMonotonic, true);
      assert.equal(
        typeof metric.metadata?.otel?.startTimeUnixNano,
        "string",
      );
      assert.equal(typeof metric.metadata?.otel?.timeUnixNano, "string");
      assert.ok(BigInt(metric.metadata.otel.startTimeUnixNano) > 0n);
      assert.ok(
        BigInt(metric.metadata.otel.startTimeUnixNano) <=
          BigInt(metric.metadata.otel.timeUnixNano),
      );
    }
  }
}

async function loadStoredHistograms(service, expectedCount) {
  const deadline = Date.now() + persistenceTimeoutMs;
  let lastStatus = 0;
  let data = [];

  while (Date.now() < deadline) {
    const url = new URL("/v1/metric-histograms", backendUrl);
    url.searchParams.set("service", service);
    url.searchParams.set("limit", "100");

    const response = await fetch(url);
    lastStatus = response.status;

    if (response.ok) {
      const body = await response.json();
      data = Array.isArray(body.data) ? body.data : [];

      if (data.length >= expectedCount) {
        break;
      }
    }

    await delay(500);
  }

  assert.equal(
    data.length,
    expectedCount,
    "Expected " +
      expectedCount +
      " stored Histograms for " +
      service +
      "; got " +
      data.length +
      " (last HTTP status " +
      lastStatus +
      ")",
  );

  return data;
}

function verifyStoredHistograms(histograms, service, expectedCount) {
  assert.equal(histograms.length, expectedCount);
  assert.ok(
    histograms.some(
      (histogram) => histogram.name === "v8js.gc.duration",
    ),
  );

  for (const histogram of histograms) {
    assert.equal(histogram.service, service);
    assert.equal(histogram.type, "histogram");
    assert.ok(
      histogram.temporality === "delta" ||
        histogram.temporality === "cumulative",
    );
    assert.match(histogram.count, /^\d+$/);
    assert.ok(Array.isArray(histogram.bucketCounts));
    assert.ok(Array.isArray(histogram.explicitBounds));
    assert.equal(
      histogram.bucketCounts.length,
      histogram.explicitBounds.length + 1,
    );
    assert.ok(
      histogram.bucketCounts.every(
        (bucketCount) =>
          typeof bucketCount === "string" && /^\d+$/.test(bucketCount),
      ),
    );
    assert.equal(
      histogram.bucketCounts.reduce(
        (total, bucketCount) => total + BigInt(bucketCount),
        0n,
      ),
      BigInt(histogram.count),
    );
    assert.match(
      histogram.timestamp,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    assert.equal(
      histogram.metadata?.otel?.resourceAttributes?.[
        "service.name"
      ],
      service,
    );
    assert.equal(
      histogram.metadata?.otel?.metricDataKind,
      "histogram",
    );
    assert.ok(
      histogram.metadata?.otel?.aggregationTemporality === 1 ||
        histogram.metadata?.otel?.aggregationTemporality === 2,
    );
    assert.equal(
      typeof histogram.metadata?.otel?.timeUnixNano,
      "string",
    );
  }
}
async function verifyRedis(
  redis,
  stream,
  group,
  service,
  expectedCount,
) {
  const entries = await redis.xRevRange(
    stream,
    "+",
    "-",
    { COUNT: 500 },
  );
  const matchingIds = new Set(
    entries.flatMap((entry) => {
      try {
        const event = JSON.parse(entry.message.event);

        return event.service === service ? [entry.id] : [];
      } catch {
        return [];
      }
    }),
  );

  assert.equal(matchingIds.size, expectedCount);

  const pending = await redis.sendCommand([
    "XPENDING",
    stream,
    group,
    "-",
    "+",
    "500",
  ]);
  assert.ok(Array.isArray(pending));

  const ownedPending = pending.filter(
    (item) =>
      Array.isArray(item) &&
      matchingIds.has(String(item[0])),
  );
  assert.deepEqual(ownedPending, []);

  return {
    streamEvents: matchingIds.size,
    ownedPending: ownedPending.length,
  };
}

async function verifyNoAlerts(services) {
  const response = await fetch(backendUrl + "/v1/alerts");
  assert.equal(response.ok, true);

  const alerts = await response.json();
  assert.ok(Array.isArray(alerts));
  assert.deepEqual(
    alerts.filter((alert) => services.includes(alert.service)),
    [],
  );
}

async function verify() {
  assert.equal(protocol, "http/json");
  await requireBackend();

  const runId = randomUUID();
  const services = [
    "phase5f2-runtime-none-" + runId,
    "phase5f2-runtime-gzip-" + runId,
  ];
  await requireNoRuleCollision(services);

  const redis = createClient({ url: redisUrl });
  await redis.connect();

  try {
    const transports = [];

    for (const [compression, service] of [
      ["none", services[0]],
      ["gzip", services[1]],
    ]) {
      const transport = await runExporter(
        compression,
        service,
      );
      const expectedGaugeCount = transport.requests.reduce(
        (total, request) => total + request.gaugePoints,
        0,
      );
      const expectedCounterCount = transport.requests.reduce(
        (total, request) => total + request.counterPoints,
        0,
      );
      const expectedHistogramCount = transport.requests.reduce(
        (total, request) => total + request.histogramPoints,
        0,
      );
      const expectedScalarCount =
        expectedGaugeCount + expectedCounterCount;
      const expectedRejected = transport.requests.reduce(
        (total, request) =>
          total + request.unsupportedPoints,
        0,
      );
      const stored = await loadStoredMetrics(
        service,
        expectedScalarCount,
      );
      const storedHistograms = await loadStoredHistograms(
        service,
        expectedHistogramCount,
      );

      verifyStoredMetrics(
        stored,
        service,
        expectedGaugeCount,
        expectedCounterCount,
      );
      verifyStoredHistograms(
        storedHistograms,
        service,
        expectedHistogramCount,
      );
      const scalarRedis = await verifyRedis(
        redis,
        "metrics",
        "metric_workers",
        service,
        expectedScalarCount,
      );
      const histogramRedis = await verifyRedis(
        redis,
        "metric_histograms",
        "metric_histogram_workers",
        service,
        expectedHistogramCount,
      );

      transports.push({
        compression,
        service,
        requests: transport.requests.length,
        acceptedGaugePoints: expectedGaugeCount,
        acceptedCounterPoints: expectedCounterCount,
        acceptedHistogramPoints: expectedHistogramCount,
        rejectedUnsupportedPoints: expectedRejected,
        storedScalarMetrics: stored.length,
        storedHistograms: storedHistograms.length,
        scalarRedisEvents: scalarRedis.streamEvents,
        histogramRedisEvents: histogramRedis.streamEvents,
        ownedScalarPendingMessages: scalarRedis.ownedPending,
        ownedHistogramPendingMessages: histogramRedis.ownedPending,
        metricNames: [
          ...new Set(
            transport.requests.flatMap(
              (request) => request.metricNames,
            ),
          ),
        ],
      });
    }

    await verifyNoAlerts(services);

    console.log(
      JSON.stringify(
        {
          event: "otel_http_json_metrics_demo_verified",
          phase: "5F2",
          protocol,
          endpoint: metricEndpoint,
          transports,
          phase5f2Alerts: 0,
          retainedDiagnosticRows: transports.reduce(
            (total, transport) =>
              total +
              transport.storedScalarMetrics +
              transport.storedHistograms,
            0,
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await redis.quit();
  }
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
