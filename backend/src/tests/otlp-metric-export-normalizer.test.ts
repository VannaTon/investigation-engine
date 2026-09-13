import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeOtlpMetricExportRequest } from "../telemetry/otlp/otlp-metric-export-normalizer.js";

function gauge(name: string, value: number): Record<string, unknown> {
  return {
    name,
    gauge: {
      dataPoints: [
        {
          timeUnixNano: "1250999999",
          asDouble: value,
        },
      ],
    },
  };
}

function sum(name: string, value: number): Record<string, unknown> {
  return {
    name,
    sum: {
      aggregationTemporality: 2,
      isMonotonic: true,
      dataPoints: [
        {
          startTimeUnixNano: "1000000000",
          timeUnixNano: "1250999999",
          asDouble: value,
        },
      ],
    },
  };
}

function histogram(
  name: string,
  pointOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    unit: "ms",
    histogram: {
      aggregationTemporality: 1,
      dataPoints: [
        {
          startTimeUnixNano: "1000000000",
          timeUnixNano: "1250999999",
          count: "2",
          sum: 3,
          min: 1,
          max: 2,
          bucketCounts: ["1", "1"],
          explicitBounds: [1],
          ...pointOverrides,
        },
      ],
    },
  };
}

function request(metrics: unknown[]): Record<string, unknown> {
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

test("single-pass normalization preserves mixed point order and counts each invalid point once", () => {
  const result = normalizeOtlpMetricExportRequest(
    request([
      gauge("demo.active", 4),
      histogram("demo.duration"),
      sum("demo.requests", 7),
      histogram("demo.invalid", { count: "3" }),
      {
        name: "demo.summary",
        summary: { dataPoints: [{}] },
      },
    ]),
  );

  assert.deepEqual(
    result.dataPoints.map((dataPoint) => [
      dataPoint.kind,
      dataPoint.event.name,
    ]),
    [
      ["scalar", "demo.active"],
      ["histogram", "demo.duration"],
      ["scalar", "demo.requests"],
    ],
  );
  assert.equal(result.rejectedDataPoints, 2);
  assert.equal(result.hasUncountableRejections, false);
  assert.deepEqual(
    result.issues.map((issue) => [issue.code, issue.path]),
    [
      [
        "histogram_count_mismatch",
        "resourceMetrics[0].scopeMetrics[0].metrics[3].histogram.dataPoints[0].bucketCounts",
      ],
      [
        "unsupported_metric_type",
        "resourceMetrics[0].scopeMetrics[0].metrics[4].summary",
      ],
    ],
  );

  const histogramEvent = result.dataPoints[1];
  assert.equal(histogramEvent?.kind, "histogram");
  if (histogramEvent?.kind === "histogram") {
    assert.deepEqual(histogramEvent.event.bucketCounts, ["1", "1"]);
    assert.deepEqual(histogramEvent.event.explicitBounds, [1]);
    assert.equal(histogramEvent.event.count, "2");
    assert.equal(histogramEvent.event.temporality, "delta");
  }
});

test("a malformed metric oneof creates one uncountable issue, not one per metric normalizer", () => {
  const result = normalizeOtlpMetricExportRequest(
    request([
      {
        name: "ambiguous",
        gauge: { dataPoints: [] },
        histogram: { aggregationTemporality: 1, dataPoints: [] },
      },
    ]),
  );

  assert.equal(result.dataPoints.length, 0);
  assert.equal(result.rejectedDataPoints, 0);
  assert.equal(result.hasUncountableRejections, true);
  assert.deepEqual(result.issues, [
    {
      code: "invalid_metric_oneof",
      path: "resourceMetrics[0].scopeMetrics[0].metrics[0]",
      message: "must contain exactly one recognized metric data kind",
      scope: "metric",
      resourceMetricsIndex: 0,
      scopeMetricsIndex: 0,
      metricIndex: 0,
    },
  ]);
});

test("a failed shared resource context rejects scalar and histogram points with one issue", () => {
  const payload = request([
    gauge("demo.active", 4),
    histogram("demo.duration"),
  ]);
  const resourceMetrics = payload.resourceMetrics as Array<
    Record<string, unknown>
  >;
  resourceMetrics[0]!.resource = {
    attributes: [
      {
        key: "service.name",
        value: { stringValue: "checkout-service" },
      },
      {
        key: "service.name",
        value: { stringValue: "duplicate-service" },
      },
    ],
  };

  const result = normalizeOtlpMetricExportRequest(payload);

  assert.equal(result.dataPoints.length, 0);
  assert.equal(result.rejectedDataPoints, 2);
  assert.equal(result.hasUncountableRejections, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.code, "duplicate_attribute");
  assert.equal(
    result.issues[0]?.path,
    "resourceMetrics[0].resource.attributes[1].key",
  );
});

test("both delta and cumulative explicit histograms remain accepted", () => {
  const cumulative = histogram("demo.cumulative");
  (
    cumulative.histogram as Record<string, unknown>
  ).aggregationTemporality = 2;

  const result = normalizeOtlpMetricExportRequest(
    request([histogram("demo.delta"), cumulative]),
  );

  assert.equal(result.rejectedDataPoints, 0);
  assert.deepEqual(
    result.dataPoints.map((dataPoint) =>
      dataPoint.kind === "histogram"
        ? dataPoint.event.temporality
        : undefined,
    ),
    ["delta", "cumulative"],
  );
});
