import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { gzipSync } from "node:zlib";
import { test } from "node:test";

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import {
  otlpMetricRoute,
  type OtlpMetricIngestionServiceLike,
  type OtlpMetricRouteOptions,
} from "../routes/otlp-metric.routes.js";
import { metricRoute } from "../routes/metric.routes.js";

import type { MetricEvent } from "../types/metric-event.js";

class FakeMetricIngestionService
  implements OtlpMetricIngestionServiceLike
{
  readonly events: MetricEvent[] = [];
  calls = 0;

  constructor(
    private readonly failOnCall?: number,
    private readonly failure = new Error("redis connection refused"),
  ) {}

  async ingest(event: MetricEvent): Promise<unknown> {
    this.calls++;

    if (this.calls === this.failOnCall) {
      throw this.failure;
    }

    this.events.push(event);

    return {
      acceptd: true,
      evenId: `event-${this.calls}`,
    };
  }
}

interface TestAppOptions {
  bodyLimitBytes?: number;
  capturedLogs?: string[];
}

async function withTestApp(
  metricIngestionService: OtlpMetricIngestionServiceLike,
  run: (app: FastifyInstance) => Promise<void>,
  options: TestAppOptions = {},
): Promise<void> {
  const app =
    options.capturedLogs === undefined
      ? Fastify({ logger: false })
      : Fastify({
          logger: {
            level: "warn",
            stream: new Writable({
              write(chunk, _encoding, callback) {
                options.capturedLogs?.push(chunk.toString());
                callback();
              },
            }),
          },
        });

  const routeOptions: OtlpMetricRouteOptions = {
    metricIngestionService,
  };

  if (options.bodyLimitBytes !== undefined) {
    routeOptions.bodyLimitBytes = options.bodyLimitBytes;
  }

  await app.register(otlpMetricRoute, routeOptions);

  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function point(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    timeUnixNano: "1250999999",
    asDouble: 2.5,
    ...overrides,
  };
}

function metric(
  points: unknown[] = [point()],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "demo.active_requests",
    unit: "1",
    gauge: { dataPoints: points },
    ...overrides,
  };
}

function sumMetric(
  points: unknown[] = [point({ startTimeUnixNano: "1000000000" })],
  sumOverrides: Record<string, unknown> = {},
  metricOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "demo.requests",
    unit: "{request}",
    sum: {
      aggregationTemporality: 2,
      isMonotonic: true,
      dataPoints: points,
      ...sumOverrides,
    },
    ...metricOverrides,
  };
}

function exportRequest(
  metrics: unknown[] = [metric()],
): Record<string, unknown> {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "checkout-service" },
            },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: "demo-meter" },
            metrics,
          },
        ],
      },
    ],
  };
}

function parseCapturedLogs(
  chunks: string[],
): Array<Record<string, unknown>> {
  return chunks
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("publishes a valid gauge and returns an empty OTLP response", async () => {
  const service = new FakeMetricIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      payload: exportRequest(),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {});
    assert.match(
      response.headers["content-type"] ?? "",
      /^application\/json/,
    );
  });

  assert.deepEqual(service.events, [
    {
      timestamp: "1970-01-01T00:00:01.250Z",
      service: "checkout-service",
      name: "demo.active_requests",
      type: "gauge",
      value: 2.5,
      unit: "1",
      metadata: {
        otel: {
          resourceAttributes: {
            "service.name": "checkout-service",
          },
          scope: { name: "demo-meter" },
          scopeAttributes: {},
          metricAttributes: {},
          dataPointAttributes: {},
          timeUnixNano: "1250999999",
          valueType: "asDouble",
          flags: 0,
        },
      },
    },
  ]);
});

test("publishes a cumulative monotonic Sum as a counter without changing the OTLP response", async () => {
  const service = new FakeMetricIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      payload: exportRequest([sumMetric()]),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {});
  });

  assert.deepEqual(service.events, [
    {
      timestamp: "1970-01-01T00:00:01.250Z",
      service: "checkout-service",
      name: "demo.requests",
      type: "counter",
      value: 2.5,
      unit: "{request}",
      metadata: {
        otel: {
          resourceAttributes: {
            "service.name": "checkout-service",
          },
          scope: { name: "demo-meter" },
          scopeAttributes: {},
          metricAttributes: {},
          metricDataKind: "sum",
          aggregationTemporality: 2,
          isMonotonic: true,
          dataPointAttributes: {},
          startTimeUnixNano: "1000000000",
          timeUnixNano: "1250999999",
          valueType: "asDouble",
          flags: 0,
        },
      },
    },
  ]);
});

test("accepts an empty OTLP metrics request without publishing", async () => {
  const service = new FakeMetricIngestionService();

  await withTestApp(service, async (app) => {
    for (const payload of [{}, { resourceMetrics: [] }]) {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/metrics",
        payload,
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {});
    }
  });

  assert.deepEqual(service.events, []);
});

test("known partial rejection publishes healthy points and reports an exact string count", async () => {
  const service = new FakeMetricIngestionService();
  const capturedLogs: string[] = [];

  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/metrics",
        payload: exportRequest([
          metric([
            point({ asDouble: 1 }),
            point({ asDouble: "bad" }),
          ]),
        ]),
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        partialSuccess: {
          rejectedDataPoints: "1",
          errorMessage:
            "Rejected 1 invalid data point. First issue: " +
            "resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints[1].asDouble: " +
            "must be a finite double",
        },
      });
    },
    { capturedLogs },
  );

  assert.deepEqual(service.events.map((event) => event.value), [1]);

  const entry = parseCapturedLogs(capturedLogs).find(
    (candidate) =>
      candidate.msg ===
      "OTLP metric batch accepted with partial success or warnings",
  );
  assert.ok(entry);
  assert.equal(entry.acceptedDataPoints, 1);
  assert.equal(entry.rejectedDataPoints, 1);
  assert.deepEqual(entry.issues, [
    {
      code: "non_finite_or_invalid_value",
      path:
        "resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints[1].asDouble",
      message: "must be a finite double",
      scope: "data_point",
      resourceMetricsIndex: 0,
      scopeMetricsIndex: 0,
      metricIndex: 0,
      dataPointIndex: 1,
    },
  ]);
});

test("mixed Gauge and Sum batches retain order and the existing partial-success shape", async () => {
  const service = new FakeMetricIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      payload: exportRequest([
        metric([point({ asDouble: 1 })]),
        sumMetric([point({ startTimeUnixNano: "1", asDouble: 2 })]),
        sumMetric([
          point({ startTimeUnixNano: "1", asDouble: 3 }),
          point({ startTimeUnixNano: "1", asDouble: 4 }),
        ], { aggregationTemporality: 1 }),
      ]),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      partialSuccess: {
        rejectedDataPoints: "2",
        errorMessage:
          "Rejected 2 invalid data points. First issue: " +
          "resourceMetrics[0].scopeMetrics[0].metrics[2].sum.aggregationTemporality: " +
          "Phase 5D supports cumulative (2) Sum metrics only",
      },
    });
  });

  assert.deepEqual(service.events.map((event) => [event.type, event.value]), [
    ["gauge", 1],
    ["counter", 2],
  ]);
});

test("an exact zero-rejection warning is returned for an empty unsupported metric", async () => {
  const service = new FakeMetricIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      payload: exportRequest([
        {
          name: "deferred.counter",
          sum: { aggregationTemporality: 2, isMonotonic: false, dataPoints: [] },
        },
      ]),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      partialSuccess: {
        rejectedDataPoints: "0",
        errorMessage:
          "Normalization warning. First issue: " +
          "resourceMetrics[0].scopeMetrics[0].metrics[0].sum.isMonotonic: " +
          "Phase 5D supports monotonic Sum metrics only",
      },
    });
  });

  assert.deepEqual(service.events, []);
});

test("a batch with only known-invalid points returns 400 and publishes nothing", async () => {
  const service = new FakeMetricIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      payload: exportRequest([
        metric([point({ asDouble: "bad" })]),
      ]),
    });

    assert.equal(response.statusCode, 400);
    assert.match(
      response.json().message,
      /contained no valid data points.*must be a finite double/,
    );
  });

  assert.deepEqual(service.events, []);
});

test("an uncountable rejection makes the HTTP batch atomic and retains diagnostics", async () => {
  const service = new FakeMetricIngestionService();
  const capturedLogs: string[] = [];

  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/metrics",
        payload: exportRequest([
          { name: "ambiguous.metric" },
          metric([point({ asDouble: 8 })]),
        ]),
      });

      assert.equal(response.statusCode, 400);
      assert.match(
        response.json().message,
        /complete rejected data point count could not be determined/,
      );
    },
    { capturedLogs },
  );

  assert.deepEqual(service.events, []);

  const entry = parseCapturedLogs(capturedLogs).find(
    (candidate) =>
      candidate.msg ===
      "OTLP metric batch rejected because its rejected-point count is unknowable",
  );
  assert.ok(entry);
  assert.equal(entry.normalizedDataPoints, 1);
  assert.equal(entry.rejectedDataPoints, 0);
  assert.equal(entry.hasUncountableRejections, true);
  assert.deepEqual(entry.issues, [
    {
      code: "invalid_metric_oneof",
      path: "resourceMetrics[0].scopeMetrics[0].metrics[0]",
      message:
        "must contain exactly one recognized metric data kind",
      scope: "metric",
      resourceMetricsIndex: 0,
      scopeMetricsIndex: 0,
      metricIndex: 0,
    },
  ]);
});

test("invalid top-level envelopes return permanent bad-data responses", async () => {
  const service = new FakeMetricIngestionService();

  await withTestApp(service, async (app) => {
    for (const payload of [
      null,
      [],
      false,
      { resourceMetrics: {} },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/metrics",
        headers: {
          "content-type": "application/json",
        },
        payload: JSON.stringify(payload),
      });

      assert.equal(response.statusCode, 400);
      assert.match(
        response.json().message,
        /Invalid OTLP metric request/,
      );
    }
  });

  assert.deepEqual(service.events, []);
});

test("accepts gzip and ordinary JSON with absent Content-Encoding", async () => {
  const service = new FakeMetricIngestionService();
  const payload = JSON.stringify(exportRequest());

  await withTestApp(service, async (app) => {
    const uncompressed = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      headers: {
        "content-type": "application/json",
      },
      payload,
    });
    assert.equal(uncompressed.statusCode, 200);

    const compressed = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      payload: gzipSync(Buffer.from(payload)),
    });
    assert.equal(compressed.statusCode, 200);
  });

  assert.equal(service.events.length, 2);
});

test("decompressed oversize returns 413 and publishes nothing", async () => {
  const service = new FakeMetricIngestionService();
  const oversized = exportRequest([
    metric([
      point({
        attributes: [
          {
            key: "large.value",
            value: { stringValue: "x".repeat(4_096) },
          },
        ],
      }),
    ]),
  ]);
  const compressed = gzipSync(
    Buffer.from(JSON.stringify(oversized)),
  );

  assert.ok(compressed.length < 1_024);

  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/metrics",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
        payload: compressed,
      });

      assert.equal(response.statusCode, 413);
      assert.deepEqual(response.json(), {
        message:
          "OTLP request body exceeds the configured decompressed size limit.",
      });
    },
    { bodyLimitBytes: 1_024 },
  );

  assert.deepEqual(service.events, []);
});

test("rejects explicit identity encoding and protobuf compatibility", async () => {
  const service = new FakeMetricIngestionService();

  await withTestApp(service, async (app) => {
    const identity = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      headers: {
        "content-type": "application/json",
        "content-encoding": "identity",
      },
      payload: JSON.stringify(exportRequest()),
    });
    assert.equal(identity.statusCode, 415);
    assert.match(identity.json().message, /JSON-only compatibility/);

    const protobuf = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      headers: {
        "content-type": "application/x-protobuf",
      },
      payload: Buffer.from([0]),
    });
    assert.equal(protobuf.statusCode, 415);
    assert.match(protobuf.json().message, /JSON-only compatibility/);
  });

  assert.deepEqual(service.events, []);
});

test("malformed JSON and invalid gzip return 400 without leaking details", async () => {
  const service = new FakeMetricIngestionService();

  await withTestApp(service, async (app) => {
    const malformed = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      headers: {
        "content-type": "application/json",
      },
      payload: '{"resourceMetrics":',
    });
    assert.equal(malformed.statusCode, 400);
    assert.deepEqual(malformed.json(), {
      message: "Invalid OTLP/HTTP JSON request body.",
    });

    const invalidGzip = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      payload: Buffer.from("not-gzip"),
    });
    assert.equal(invalidGzip.statusCode, 400);
    assert.deepEqual(invalidGzip.json(), {
      message: "Invalid OTLP/HTTP JSON request body.",
    });
  });

  assert.deepEqual(service.events, []);
});

test("a mid-batch publishing failure returns 503 and logs the published prefix", async () => {
  const service = new FakeMetricIngestionService(2);
  const capturedLogs: string[] = [];

  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/metrics",
        payload: exportRequest([
          metric([
            point({ asDouble: 1 }),
            point({ asDouble: 2 }),
            point({ asDouble: 3 }),
          ]),
        ]),
      });

      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), {
        message: "Metric ingestion is temporarily unavailable.",
      });
      assert.doesNotMatch(
        response.body,
        /redis connection refused/,
      );
    },
    { capturedLogs },
  );

  assert.deepEqual(service.events.map((event) => event.value), [1]);
  assert.equal(service.calls, 2);

  const entry = parseCapturedLogs(capturedLogs).find(
    (candidate) =>
      candidate.msg === "OTLP metric publishing failed",
  );
  assert.ok(entry);
  assert.equal(entry.normalizedDataPoints, 3);
  assert.equal(entry.publishedDataPoints, 1);
  assert.equal(entry.rejectedDataPoints, 0);
});

test("the OTLP and legacy metrics routes coexist on separate paths", async () => {
  const app = Fastify({ logger: false });
  const service = new FakeMetricIngestionService();

  await app.register(otlpMetricRoute, {
    metricIngestionService: service,
  });
  await app.register(metricRoute);
  await app.ready();

  try {
    assert.equal(
      app.hasRoute({
        method: "POST",
        url: "/otlp/v1/metrics",
      }),
      true,
    );
    assert.equal(
      app.hasRoute({
        method: "POST",
        url: "/v1/metrics",
      }),
      true,
    );
  } finally {
    await app.close();
  }
});

test("Phase 5F1 does not change live receiver Histogram rejection", async () => {
  const service = new FakeMetricIngestionService();
  const histogram = {
    name: "demo.request.duration",
    unit: "ms",
    histogram: {
      aggregationTemporality: 1,
      dataPoints: [
        {
          startTimeUnixNano: "1000000000",
          timeUnixNano: "1250999999",
          count: "2",
          sum: 3,
          bucketCounts: ["1", "1"],
          explicitBounds: [1],
        },
      ],
    },
  };

  await withTestApp(service, async (app) => {
    const histogramOnly = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      payload: exportRequest([histogram]),
    });
    assert.equal(histogramOnly.statusCode, 400);
    assert.match(
      histogramOnly.json().message,
      /contained no valid data points.*supports Gauge and cumulative monotonic Sum metrics only/,
    );
    assert.deepEqual(service.events, []);

    const mixed = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      payload: exportRequest([
        metric([point({ asDouble: 9 })]),
        histogram,
      ]),
    });
    assert.equal(mixed.statusCode, 200);
    assert.deepEqual(mixed.json(), {
      partialSuccess: {
        rejectedDataPoints: "1",
        errorMessage:
          "Rejected 1 invalid data point. First issue: " +
          "resourceMetrics[0].scopeMetrics[0].metrics[1].histogram: " +
          "Phase 5D supports Gauge and cumulative monotonic Sum metrics only",
      },
    });
  });

  assert.deepEqual(
    service.events.map((event) => [event.type, event.value]),
    [["gauge", 9]],
  );
});
