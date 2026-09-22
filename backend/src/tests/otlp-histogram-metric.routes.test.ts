import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import {
  otlpMetricRoute,
  type OtlpHistogramMetricIngestionServiceLike,
  type OtlpMetricIngestionServiceLike,
} from "../routes/otlp-metric.routes.js";
import type { HistogramMetricEvent } from "../types/histogram-metric-event.js";
import type { MetricEvent } from "../types/metric-event.js";
import { LOCAL_DEVELOPMENT_APPLICATION_ID } from "../types/application.js";

const authenticator = {
  authenticateAuthorizationHeader: async () => LOCAL_DEVELOPMENT_APPLICATION_ID,
};

function gauge(): Record<string, unknown> {
  return {
    name: "demo.active",
    gauge: {
      dataPoints: [
        {
          timeUnixNano: "1250999999",
          asDouble: 4,
        },
      ],
    },
  };
}

function sum(): Record<string, unknown> {
  return {
    name: "demo.requests",
    sum: {
      aggregationTemporality: 2,
      isMonotonic: true,
      dataPoints: [
        {
          startTimeUnixNano: "1000000000",
          timeUnixNano: "1250999999",
          asDouble: 7,
        },
      ],
    },
  };
}

function histogram(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "demo.duration",
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
          ...overrides,
        },
      ],
    },
  };
}

function exportRequest(metrics: unknown[]): Record<string, unknown> {
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
            scope: { name: "phase5f2-meter" },
            metrics,
          },
        ],
      },
    ],
  };
}

interface Harness {
  scalarEvents: MetricEvent[];
  histogramEvents: HistogramMetricEvent[];
  calls: string[];
  capturedLogs: string[];
}

async function withEnabledApp(
  run: (app: FastifyInstance, harness: Harness) => Promise<void>,
  options: {
    failHistogram?: boolean;
    captureLogs?: boolean;
  } = {},
): Promise<void> {
  const harness: Harness = {
    scalarEvents: [],
    histogramEvents: [],
    calls: [],
    capturedLogs: [],
  };
  const app = options.captureLogs
    ? Fastify({
        logger: {
          level: "warn",
          stream: new Writable({
            write(chunk, _encoding, callback) {
              harness.capturedLogs.push(chunk.toString());
              callback();
            },
          }),
        },
      })
    : Fastify({ logger: false });

  const scalarService: OtlpMetricIngestionServiceLike = {
    async ingest(event) {
      harness.scalarEvents.push(event);
      harness.calls.push("scalar:" + event.name);
    },
  };
  const histogramService: OtlpHistogramMetricIngestionServiceLike = {
    async ingest(event) {
      harness.calls.push("histogram:" + event.name);

      if (options.failHistogram === true) {
        throw new Error("private redis histogram failure");
      }

      harness.histogramEvents.push(event);
    },
  };

  await app.register(otlpMetricRoute, {
    metricIngestionService: scalarService,
    authenticator,
    histogramMetricIngestionService: histogramService,
    explicitHistogramsEnabled: true,
  });

  try {
    await run(app, harness);
  } finally {
    await app.close();
  }
}

function logEntries(chunks: string[]): Array<Record<string, unknown>> {
  return chunks
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("enabled receiver publishes mixed scalar and histogram points in input order", async () => {
  await withEnabledApp(async (app, harness) => {
    const response = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      payload: exportRequest([gauge(), histogram(), sum()]),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {});
    assert.deepEqual(harness.calls, [
      "scalar:demo.active",
      "histogram:demo.duration",
      "scalar:demo.requests",
    ]);
    assert.equal(harness.scalarEvents.length, 2);
    assert.deepEqual(harness.histogramEvents, [
      {
        applicationId: LOCAL_DEVELOPMENT_APPLICATION_ID,
        timestamp: "1970-01-01T00:00:01.250Z",
        service: "checkout-service",
        name: "demo.duration",
        type: "histogram",
        unit: "ms",
        temporality: "delta",
        count: "2",
        sum: 3,
        bucketCounts: ["1", "1"],
        explicitBounds: [1],
        metadata: {
          otel: {
            resourceAttributes: {
              "service.name": "checkout-service",
            },
            scope: { name: "phase5f2-meter" },
            scopeAttributes: {},
            metricAttributes: {},
            metricDataKind: "histogram",
            aggregationTemporality: 1,
            dataPointAttributes: {},
            timeUnixNano: "1250999999",
            startTimeUnixNano: "1000000000",
            flags: 0,
          },
        },
      },
    ]);
  });
});

test("enabled receiver reports invalid histogram points once while publishing healthy siblings", async () => {
  await withEnabledApp(async (app, harness) => {
    const response = await app.inject({
      method: "POST",
      url: "/otlp/v1/metrics",
      payload: exportRequest([
        gauge(),
        histogram({ count: "3" }),
      ]),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      partialSuccess: {
        rejectedDataPoints: "1",
        errorMessage:
          "Rejected 1 invalid data point. First issue: " +
          "resourceMetrics[0].scopeMetrics[0].metrics[1].histogram.dataPoints[0].bucketCounts: " +
          "must sum exactly to count",
      },
    });
    assert.deepEqual(harness.calls, ["scalar:demo.active"]);
  });
});

test("histogram publication failure returns a generic 503 and structured prefix counts", async () => {
  await withEnabledApp(
    async (app, harness) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/metrics",
        payload: exportRequest([gauge(), histogram(), sum()]),
      });

      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), {
        message: "Metric ingestion is temporarily unavailable.",
      });
      assert.doesNotMatch(response.body, /private redis histogram failure/);
      assert.deepEqual(harness.calls, [
        "scalar:demo.active",
        "histogram:demo.duration",
      ]);

      const entry = logEntries(harness.capturedLogs).find(
        (candidate) => candidate.msg === "OTLP metric publishing failed",
      );
      assert.ok(entry);
      assert.equal(entry.normalizedDataPoints, 3);
      assert.equal(entry.normalizedScalarDataPoints, 2);
      assert.equal(entry.normalizedHistogramDataPoints, 1);
      assert.equal(entry.publishedDataPoints, 1);
      assert.equal(entry.publishedScalarDataPoints, 1);
      assert.equal(entry.publishedHistogramDataPoints, 0);
    },
    { failHistogram: true, captureLogs: true },
  );
});

test("enabled histogram receiver retains ordinary JSON and gzip compatibility", async () => {
  await withEnabledApp(async (app, harness) => {
    const payload = JSON.stringify(exportRequest([histogram()]));

    for (const request of [
      {
        headers: { "content-type": "application/json" },
        payload,
      },
      {
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
        payload: gzipSync(Buffer.from(payload)),
      },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/metrics",
        ...request,
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {});
    }

    assert.equal(harness.histogramEvents.length, 2);
  });
});

test("enabling histograms without a histogram ingestion service fails app startup", async () => {
  const app = Fastify({ logger: false });
  const scalarService: OtlpMetricIngestionServiceLike = {
    async ingest() {},
  };

  app.register(otlpMetricRoute, {
    metricIngestionService: scalarService,
    authenticator,
    explicitHistogramsEnabled: true,
  });

  await assert.rejects(
    async () => {
      await app.ready();
    },
    /Histogram metric ingestion service is required/,
  );
  await app.close();
});
