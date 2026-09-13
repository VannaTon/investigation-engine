import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeOtlpExplicitHistogramRequest as normalize,
} from "../telemetry/otlp/otlp-explicit-histogram-normalizer.js";
import {
  OtlpMetricNormalizationError,
  OTLP_METRIC_LIMITS,
} from "../telemetry/otlp/otlp-metric-normalizer.js";
import type { HistogramMetricEvent } from "../types/histogram-metric-event.js";

type RecordValue = Record<string, unknown>;

const POINT_PATH =
  "resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0]";

function histogramPoint(
  overrides: RecordValue = {},
): RecordValue {
  return {
    startTimeUnixNano: "1000000000",
    timeUnixNano: "1250999999",
    count: "3",
    sum: 4.5,
    bucketCounts: ["1", "2"],
    explicitBounds: [1],
    min: 0.25,
    max: 4,
    ...overrides,
  };
}

function histogramMetric(
  points: unknown[] = [histogramPoint()],
  histogramOverrides: RecordValue = {},
  metricOverrides: RecordValue = {},
): RecordValue {
  return {
    name: "demo.request.duration",
    unit: "ms",
    description: "Request duration distribution",
    histogram: {
      aggregationTemporality: 1,
      dataPoints: points,
      ...histogramOverrides,
    },
    ...metricOverrides,
  };
}

function gaugeMetric(): RecordValue {
  return {
    name: "demo.active",
    gauge: {
      dataPoints: [{ timeUnixNano: "1250999999", asDouble: 1 }],
    },
  };
}

function request(metrics: unknown[] = [histogramMetric()]) {
  return {
    resourceMetrics: [
      {
        schemaUrl: "resource-schema",
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "checkout-service" },
            },
            {
              key: "deployment.environment",
              value: { stringValue: "test" },
            },
          ],
        },
        scopeMetrics: [
          {
            schemaUrl: "scope-schema",
            scope: {
              name: "demo-meter",
              version: "1.0.0",
            },
            metrics,
          },
        ],
      },
    ],
  };
}

function one(input: unknown): HistogramMetricEvent {
  const result = normalize(input);
  assert.equal(result.rejectedDataPoints, 0);
  assert.equal(result.hasUncountableRejections, false);
  assert.deepEqual(result.issues, []);
  assert.equal(result.events.length, 1);
  return result.events[0]!;
}

function otel(event: HistogramMetricEvent): RecordValue {
  return event.metadata!.otel as RecordValue;
}

test("maps a delta explicit Histogram without flattening its distribution", () => {
  const event = one(request());

  assert.deepEqual(event, {
    timestamp: "1970-01-01T00:00:01.250Z",
    service: "checkout-service",
    name: "demo.request.duration",
    type: "histogram",
    unit: "ms",
    temporality: "delta",
    count: "3",
    sum: 4.5,
    min: 0.25,
    max: 4,
    bucketCounts: ["1", "2"],
    explicitBounds: [1],
    metadata: {
      otel: {
        resourceAttributes: {
          "service.name": "checkout-service",
          "deployment.environment": "test",
        },
        resourceSchemaUrl: "resource-schema",
        scope: {
          name: "demo-meter",
          version: "1.0.0",
        },
        scopeAttributes: {},
        scopeSchemaUrl: "scope-schema",
        metricAttributes: {},
        metricDescription: "Request duration distribution",
        metricDataKind: "histogram",
        aggregationTemporality: 1,
        dataPointAttributes: {},
        timeUnixNano: "1250999999",
        flags: 0,
        startTimeUnixNano: "1000000000",
      },
    },
  });
});

test("maps cumulative and bucketless Histograms without inventing statistics", () => {
  const cumulative = one(request([
    histogramMetric([
      histogramPoint({
        startTimeUnixNano: undefined,
        count: "7",
        sum: undefined,
        min: undefined,
        max: undefined,
        bucketCounts: undefined,
        explicitBounds: undefined,
      }),
    ], { aggregationTemporality: 2 }),
  ]));

  assert.equal(cumulative.temporality, "cumulative");
  assert.equal(cumulative.count, "7");
  assert.deepEqual(cumulative.bucketCounts, []);
  assert.deepEqual(cumulative.explicitBounds, []);
  assert.equal("sum" in cumulative, false);
  assert.equal("min" in cumulative, false);
  assert.equal("max" in cumulative, false);
  assert.equal("startTimeUnixNano" in otel(cumulative), false);

  const zero = one(request([
    histogramMetric([
      histogramPoint({
        count: undefined,
        sum: undefined,
        min: undefined,
        max: undefined,
        bucketCounts: undefined,
        explicitBounds: undefined,
      }),
    ]),
  ]));
  assert.equal(zero.count, "0");
});

test("preserves the full UInt64 count range as decimal strings", () => {
  const maximum = "18446744073709551615";
  const event = one(request([
    histogramMetric([
      histogramPoint({
        count: maximum,
        bucketCounts: [maximum],
        explicitBounds: [],
      }),
    ]),
  ]));

  assert.equal(event.count, maximum);
  assert.deepEqual(event.bucketCounts, [maximum]);
});

test("accepts safe numeric counts and rejects unsafe JavaScript integers", () => {
  const safe = Number.MAX_SAFE_INTEGER;
  const event = one(request([
    histogramMetric([
      histogramPoint({
        count: safe,
        bucketCounts: [safe],
        explicitBounds: [],
      }),
    ]),
  ]));
  assert.equal(event.count, String(safe));

  const unsafeCount = normalize(request([
    histogramMetric([
      histogramPoint({
        count: Number.MAX_SAFE_INTEGER + 1,
        bucketCounts: [],
        explicitBounds: [],
      }),
    ]),
  ]));
  assert.equal(unsafeCount.events.length, 0);
  assert.equal(unsafeCount.issues[0]!.path, POINT_PATH + ".count");

  const unsafeBucket = normalize(request([
    histogramMetric([
      histogramPoint({
        count: "9007199254740992",
        bucketCounts: [Number.MAX_SAFE_INTEGER + 1],
        explicitBounds: [],
      }),
    ]),
  ]));
  assert.equal(unsafeBucket.events.length, 0);
  assert.equal(
    unsafeBucket.issues[0]!.path,
    POINT_PATH + ".bucketCounts[0]",
  );
});

test("accepts only numeric delta or cumulative Histogram temporality", () => {
  for (const value of [undefined, null, 0, 3, "1", 1.5]) {
    const result = normalize(request([
      histogramMetric(undefined, {
        aggregationTemporality: value,
      }),
    ]));

    assert.equal(result.events.length, 0);
    assert.equal(result.rejectedDataPoints, 1);
    assert.equal(
      result.issues[0]!.path,
      "resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.aggregationTemporality",
    );
    assert.equal(result.issues[0]!.scope, "metric");
    assert.equal(
      result.issues[0]!.code,
      typeof value === "string" ||
        (typeof value === "number" && !Number.isSafeInteger(value))
        ? "invalid_histogram_temporality"
        : "unsupported_histogram_temporality",
    );
  }
});

test("validates Histogram end and optional start timestamps", () => {
  const result = normalize(request([
    histogramMetric([
      histogramPoint({ timeUnixNano: "0" }),
      histogramPoint({ startTimeUnixNano: "0" }),
      histogramPoint({ startTimeUnixNano: "1251000000" }),
      histogramPoint({ timeUnixNano: "18446744073709551616" }),
      histogramPoint(),
    ]),
  ]));

  assert.equal(result.events.length, 1);
  assert.equal(result.rejectedDataPoints, 4);
  assert.deepEqual(
    result.issues.map((issue) => issue.dataPointIndex),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "invalid_field",
      "invalid_histogram_interval",
      "invalid_histogram_interval",
      "invalid_field",
    ],
  );
});

test("rejects invalid bucket shapes and population mismatches", () => {
  const result = normalize(request([
    histogramMetric([
      histogramPoint({
        count: "2",
        bucketCounts: [],
        explicitBounds: [1],
      }),
      histogramPoint({
        count: "2",
        bucketCounts: ["1", "1"],
        explicitBounds: [],
      }),
      histogramPoint({
        count: "3",
        bucketCounts: ["1", "1"],
        explicitBounds: [1],
      }),
      histogramPoint(),
    ]),
  ]));

  assert.equal(result.events.length, 1);
  assert.equal(result.rejectedDataPoints, 3);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "invalid_histogram_bucket_shape",
      "invalid_histogram_bucket_shape",
      "histogram_count_mismatch",
    ],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.dataPointIndex),
    [0, 1, 2],
  );
});

test("requires finite strictly increasing explicit bounds", () => {
  const valid = one(request([
    histogramMetric([
      histogramPoint({
        count: "4",
        bucketCounts: ["1", "1", "1", "1"],
        explicitBounds: ["-1", "0", "1.5"],
      }),
    ]),
  ]));
  assert.deepEqual(valid.explicitBounds, [-1, 0, 1.5]);

  for (const bounds of [[1, 1], [2, 1], [1, "Infinity"]]) {
    const result = normalize(request([
      histogramMetric([
        histogramPoint({
          count: "3",
          bucketCounts: ["1", "1", "1"],
          explicitBounds: bounds,
        }),
      ]),
    ]));
    assert.equal(result.events.length, 0);
    assert.equal(result.rejectedDataPoints, 1);
    assert.match(result.issues[0]!.path, /explicitBounds/);
  }
});

test("preserves negative sums and validates optional finite min and max", () => {
  const event = one(request([
    histogramMetric([
      histogramPoint({
        sum: -4,
        min: -3,
        max: 2,
      }),
    ]),
  ]));
  assert.equal(event.sum, -4);
  assert.equal(event.min, -3);
  assert.equal(event.max, 2);

  const reversed = normalize(request([
    histogramMetric([
      histogramPoint({ min: 3, max: 2 }),
    ]),
  ]));
  assert.equal(reversed.issues[0]!.code, "invalid_histogram_range");
  assert.equal(reversed.issues[0]!.path, POINT_PATH + ".min");

  const nonFinite = normalize(request([
    histogramMetric([
      histogramPoint({ sum: "NaN" }),
    ]),
  ]));
  assert.equal(
    nonFinite.issues[0]!.code,
    "non_finite_or_invalid_value",
  );
  assert.equal(nonFinite.issues[0]!.path, POINT_PATH + ".sum");
});

test("rejects no-recorded-value and reserved Histogram flags", () => {
  for (const flags of [1, 2, "1", -1, 4_294_967_296]) {
    const result = normalize(request([
      histogramMetric([histogramPoint({ flags })]),
    ]));
    assert.equal(result.events.length, 0);
    assert.equal(result.rejectedDataPoints, 1);
    assert.equal(result.issues[0]!.path, POINT_PATH + ".flags");
  }
});

test("preserves attribute provenance and validated exemplars", () => {
  const event = one(request([
    histogramMetric([
      histogramPoint({
        attributes: [
          { key: "route", value: { stringValue: "/checkout" } },
        ],
        exemplars: [
          {
            timeUnixNano: "1200000000",
            asInt: "7",
            traceId: "ABCDEF0123456789ABCDEF0123456789",
            spanId: "ABCDEF0123456789",
            filteredAttributes: [
              { key: "sampled", value: { boolValue: true } },
            ],
          },
        ],
      }),
    ], {}, {
      metadata: [
        { key: "source", value: { stringValue: "runtime" } },
      ],
    }),
  ]));
  const data = otel(event);

  assert.equal(
    (data.resourceAttributes as RecordValue)["deployment.environment"],
    "test",
  );
  assert.deepEqual(data.scope, {
    name: "demo-meter",
    version: "1.0.0",
  });
  assert.equal(
    (data.metricAttributes as RecordValue).source,
    "runtime",
  );
  assert.equal(
    (data.dataPointAttributes as RecordValue).route,
    "/checkout",
  );
  assert.deepEqual(data.exemplars, [
    {
      timeUnixNano: "1200000000",
      filteredAttributes: { sampled: true },
      asInt: 7,
      traceId: "abcdef0123456789abcdef0123456789",
      spanId: "abcdef0123456789",
    },
  ]);
});

test("enforces the explicit Histogram bucket-count limit before mapping", () => {
  const tooMany = Array.from(
    { length: OTLP_METRIC_LIMITS.histogramBucketsPerPoint + 1 },
    () => "0",
  );
  const result = normalize(request([
    histogramMetric([
      histogramPoint({
        count: "0",
        bucketCounts: tooMany,
        explicitBounds: [],
      }),
    ]),
  ]));

  assert.equal(result.events.length, 0);
  assert.equal(result.rejectedDataPoints, 1);
  assert.equal(
    result.issues[0]!.code,
    "histogram_bucket_limit_exceeded",
  );
  assert.equal(result.issues[0]!.path, POINT_PATH + ".bucketCounts");
});

test("retains healthy Histogram siblings in input order with exact paths", () => {
  const result = normalize(request([
    histogramMetric([
      histogramPoint({
        count: "1",
        bucketCounts: ["1"],
        explicitBounds: [],
      }),
      null,
      histogramPoint({
        count: "2",
        bucketCounts: ["2"],
        explicitBounds: [],
        sum: 8,
      }),
    ]),
  ]));

  assert.deepEqual(
    result.events.map((event) => [event.count, event.sum]),
    [["1", 4.5], ["2", 8]],
  );
  assert.equal(result.rejectedDataPoints, 1);
  assert.equal(result.issues[0]!.scope, "data_point");
  assert.equal(result.issues[0]!.dataPointIndex, 1);
  assert.equal(
    result.issues[0]!.path,
    "resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[1]",
  );
});

test("ignores other recognized metric kinds without relabeling them", () => {
  const result = normalize(request([
    gaugeMetric(),
    histogramMetric(),
    {
      name: "demo.exponential",
      exponentialHistogram: { dataPoints: [{}] },
    },
    {
      name: "demo.summary",
      summary: { dataPoints: [{}] },
    },
  ]));

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]!.type, "histogram");
  assert.equal(result.rejectedDataPoints, 0);
  assert.equal(result.hasUncountableRejections, false);
  assert.deepEqual(result.issues, []);
});

test("marks malformed containers uncountable while retaining healthy siblings", () => {
  const malformedMetric = normalize(request([
    null,
    histogramMetric(),
  ]));
  assert.equal(malformedMetric.events.length, 1);
  assert.equal(malformedMetric.hasUncountableRejections, true);
  assert.equal(malformedMetric.issues[0]!.metricIndex, 0);

  const malformedPoints = normalize(request([
    histogramMetric([], { dataPoints: "bad" }),
    histogramMetric(),
  ]));
  assert.equal(malformedPoints.events.length, 1);
  assert.equal(malformedPoints.hasUncountableRejections, true);
  assert.match(
    malformedPoints.issues[0]!.path,
    /histogram\.dataPoints$/,
  );
});

test("counts known Histogram descendants once when resource context fails", () => {
  const healthyResource = request().resourceMetrics[0]!;
  const badResource = {
    ...healthyResource,
    resource: { attributes: "bad" },
    scopeMetrics: [
      {
        scope: { name: "bad-scope" },
        metrics: [
          histogramMetric([
            histogramPoint(),
            histogramPoint(),
          ]),
        ],
      },
    ],
  };
  const result = normalize({
    resourceMetrics: [badResource, healthyResource],
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.rejectedDataPoints, 2);
  assert.equal(result.hasUncountableRejections, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.scope, "resource");
  assert.equal(result.issues[0]!.resourceMetricsIndex, 0);
});

test("enforces existing metadata limits on Histogram provenance", () => {
  const result = normalize(request([
    histogramMetric([
      histogramPoint({
        attributes: [
          {
            key: "payload",
            value: {
              stringValue: "x".repeat(
                OTLP_METRIC_LIMITS.metadataBytes,
              ),
            },
          },
        ],
      }),
    ]),
  ]));

  assert.equal(result.events.length, 0);
  assert.equal(result.rejectedDataPoints, 1);
  assert.equal(result.issues[0]!.code, "metadata_limit_exceeded");
});

test("only invalid top-level envelopes throw", () => {
  for (const input of [null, undefined, [], false, 42, "{}", {
    resourceMetrics: {},
  }]) {
    assert.throws(
      () => normalize(input),
      OtlpMetricNormalizationError,
    );
  }

  assert.deepEqual(normalize({}), {
    events: [],
    rejectedDataPoints: 0,
    hasUncountableRejections: false,
    issues: [],
  });
});
