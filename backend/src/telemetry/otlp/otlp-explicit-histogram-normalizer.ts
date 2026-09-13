import type { HistogramMetricEvent } from "../../types/histogram-metric-event.js";
import {
  OTLP_METRIC_LIMITS,
  OtlpMetricNormalizationError,
  otlpMetricNormalizationHelpers,
  type OtlpMetricNormalizationIssue,
} from "./otlp-metric-normalizer.js";

type JsonRecord = Record<string, unknown>;
type HistogramTemporality = HistogramMetricEvent["temporality"];

const KINDS = [
  "gauge",
  "sum",
  "histogram",
  "exponentialHistogram",
  "summary",
] as const;

const {
  attributes,
  byteLimit,
  exemplar,
  fail,
  field,
  finiteDouble,
  list,
  metricContext,
  present,
  record,
  resourceContext,
  scopeContext,
  uint32,
  unsigned,
} = otlpMetricNormalizationHelpers;

export interface OtlpExplicitHistogramNormalizationResult {
  events: HistogramMetricEvent[];
  /** Counts known rejected Histogram points, once per point. */
  rejectedDataPoints: number;
  /** A malformed container prevented an exact Histogram-point count. */
  hasUncountableRejections: boolean;
  issues: OtlpMetricNormalizationIssue[];
}

export function histogramTemporality(
  data: JsonRecord,
  path: string,
): { code: 1 | 2; label: HistogramTemporality } {
  const at = path + ".aggregationTemporality";
  const value = field(data, "aggregationTemporality");

  if (!present(value) || value === 0) {
    fail(
      at,
      "must be delta (1) or cumulative (2); unspecified temporality is unsupported",
      "unsupported_histogram_temporality",
    );
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(
      at,
      "must be an integer OTLP enum value",
      "invalid_histogram_temporality",
    );
  }

  if (value !== 1 && value !== 2) {
    fail(
      at,
      "must be delta (1) or cumulative (2)",
      "unsupported_histogram_temporality",
    );
  }

  const code = value as 1 | 2;

  return {
    code,
    label: code === 1 ? "delta" : "cumulative",
  };
}

function boundedHistogramArrays(
  point: JsonRecord,
  path: string,
): { bucketCounts: string[]; explicitBounds: number[]; count: bigint } {
  const countValue = field(point, "count");
  const count = present(countValue)
    ? unsigned(countValue, path + ".count")
    : 0n;
  const rawCounts = list(field(point, "bucketCounts"), path + ".bucketCounts");
  const rawBounds = list(field(point, "explicitBounds"), path + ".explicitBounds");

  if (
    rawCounts.length > OTLP_METRIC_LIMITS.histogramBucketsPerPoint ||
    rawBounds.length > OTLP_METRIC_LIMITS.histogramBucketsPerPoint
  ) {
    fail(
      rawCounts.length > OTLP_METRIC_LIMITS.histogramBucketsPerPoint
        ? path + ".bucketCounts"
        : path + ".explicitBounds",
      "exceeds the explicit histogram bucket limit",
      "histogram_bucket_limit_exceeded",
    );
  }

  if (
    (rawCounts.length === 0 && rawBounds.length !== 0) ||
    (rawCounts.length !== 0 && rawCounts.length !== rawBounds.length + 1)
  ) {
    fail(
      path + ".bucketCounts",
      "must be empty with explicitBounds or contain exactly one more entry than explicitBounds",
      "invalid_histogram_bucket_shape",
    );
  }

  const bucketValues = rawCounts.map((value, index) =>
    unsigned(value, path + ".bucketCounts[" + index + "]"),
  );
  const explicitBounds = rawBounds.map((value, index) =>
    finiteDouble(value, path + ".explicitBounds[" + index + "]"),
  );

  for (let index = 1; index < explicitBounds.length; index++) {
    if (explicitBounds[index]! <= explicitBounds[index - 1]!) {
      fail(
        path + ".explicitBounds[" + index + "]",
        "must be strictly greater than the previous explicit bound",
        "invalid_histogram_bounds",
      );
    }
  }

  // Empty arrays represent a valid bucketless histogram. When buckets are
  // present, their population must exactly match the point count.
  if (
    bucketValues.length > 0 &&
    bucketValues.reduce((total, value) => total + value, 0n) !== count
  ) {
    fail(
      path + ".bucketCounts",
      "must sum exactly to count",
      "histogram_count_mismatch",
    );
  }

  return {
    bucketCounts: bucketValues.map((value) => value.toString()),
    explicitBounds,
    count,
  };
}

function optionalStatistic(
  point: JsonRecord,
  key: "sum" | "min" | "max",
  path: string,
): number | undefined {
  const value = field(point, key);
  return present(value)
    ? finiteDouble(value, path + "." + key)
    : undefined;
}

export function normalizeHistogramPoint(
  value: unknown,
  path: string,
  service: string,
  metric: ReturnType<typeof metricContext>,
  base: JsonRecord,
  temporality: ReturnType<typeof histogramTemporality>,
): HistogramMetricEvent {
  const point = record(value, path);
  const flags = uint32(field(point, "flags"), path + ".flags");

  if (flags !== 0) {
    fail(
      path + ".flags",
      (flags & 1) !== 0
        ? "no-recorded-value markers cannot be represented by HistogramMetricEvent"
        : "unsupported data point flags",
      "unsupported_data_point_flags",
    );
  }

  const nanos = unsigned(field(point, "timeUnixNano"), path + ".timeUnixNano");
  if (nanos === 0n) {
    fail(path + ".timeUnixNano", "must not be zero");
  }

  const distribution = boundedHistogramArrays(point, path);
  const sum = optionalStatistic(point, "sum", path);
  const min = optionalStatistic(point, "min", path);
  const max = optionalStatistic(point, "max", path);

  if (min !== undefined && max !== undefined && min > max) {
    fail(
      path + ".min",
      "must not be greater than max",
      "invalid_histogram_range",
    );
  }

  const budget = { values: 0 };
  const otel: JsonRecord = {
    ...base,
    ...metric.otel,
    metricDataKind: "histogram",
    aggregationTemporality: temporality.code,
    dataPointAttributes: attributes(
      field(point, "attributes"),
      path + ".attributes",
      budget,
    ),
    timeUnixNano: nanos.toString(),
    flags,
  };

  const startValue = field(point, "startTimeUnixNano");
  if (present(startValue)) {
    const start = unsigned(startValue, path + ".startTimeUnixNano");
    if (start === 0n || start > nanos) {
      fail(
        path + ".startTimeUnixNano",
        "must be non-zero and not after timeUnixNano when supplied",
        "invalid_histogram_interval",
      );
    }
    otel.startTimeUnixNano = start.toString();
  }

  const exemplars = list(field(point, "exemplars"), path + ".exemplars");
  if (exemplars.length > OTLP_METRIC_LIMITS.exemplarsPerPoint) {
    fail(
      path + ".exemplars",
      "exceeds the exemplar count limit",
      "metadata_limit_exceeded",
    );
  }
  if (present(field(point, "exemplars"))) {
    otel.exemplars = exemplars.map((entry, index) =>
      exemplar(entry, path + ".exemplars[" + index + "]", budget),
    );
  }

  const metadata = { otel };
  byteLimit(metadata, path);

  const event: HistogramMetricEvent = {
    timestamp: new Date(Number(nanos / 1_000_000n)).toISOString(),
    service,
    name: metric.name,
    type: "histogram",
    temporality: temporality.label,
    count: distribution.count.toString(),
    bucketCounts: distribution.bucketCounts,
    explicitBounds: distribution.explicitBounds,
    metadata: JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>,
  };

  if (metric.unit !== undefined) event.unit = metric.unit;
  if (sum !== undefined) event.sum = sum;
  if (min !== undefined) event.min = min;
  if (max !== undefined) event.max = max;

  return event;
}

/**
 * Pure, contract-only OTLP explicit Histogram normalization.
 * Other recognized metric kinds are ignored. Nothing in the live receiver
 * calls this function during Phase 5F1.
 */
export function normalizeOtlpExplicitHistogramRequest(
  request: unknown,
): OtlpExplicitHistogramNormalizationResult {
  const root = record(request, "request");
  const resources = list(field(root, "resourceMetrics"), "resourceMetrics");
  const result: OtlpExplicitHistogramNormalizationResult = {
    events: [],
    rejectedDataPoints: 0,
    hasUncountableRejections: false,
    issues: [],
  };
  type Location = Omit<
    OtlpMetricNormalizationIssue,
    "code" | "path" | "message"
  >;

  function issue(
    error: unknown,
    location: Location,
    uncountable = false,
  ): void {
    if (!(error instanceof OtlpMetricNormalizationError)) throw error;
    result.issues.push({
      code: error.code,
      path: error.path,
      message: error.reason,
      ...location,
    });
    if (uncountable) result.hasUncountableRejections = true;
  }

  resources.forEach((rawResource, resourceMetricsIndex) => {
    const resourcePath = "resourceMetrics[" + resourceMetricsIndex + "]";
    const resourceLocation: Location = {
      scope: "resource",
      resourceMetricsIndex,
    };
    let resourceMetric: JsonRecord;
    let scopes: unknown[];
    try {
      resourceMetric = record(rawResource, resourcePath);
      scopes = list(
        field(resourceMetric, "scopeMetrics"),
        resourcePath + ".scopeMetrics",
      );
    } catch (error) {
      issue(error, resourceLocation, true);
      return;
    }

    let resource: JsonRecord = {};
    let resourceFailed = false;
    try {
      resource = resourceContext(resourceMetric, resourcePath);
    } catch (error) {
      issue(error, resourceLocation);
      resourceFailed = true;
    }

    const resourceAttributes = (resource.resourceAttributes ?? {}) as JsonRecord;
    const serviceValue = field(resourceAttributes, "service.name");
    const service =
      typeof serviceValue === "string" && serviceValue.trim() !== ""
        ? serviceValue
        : "unknown_service";

    scopes.forEach((rawScope, scopeMetricsIndex) => {
      const scopePath =
        resourcePath + ".scopeMetrics[" + scopeMetricsIndex + "]";
      const scopeLocation: Location = {
        scope: "scope",
        resourceMetricsIndex,
        scopeMetricsIndex,
      };
      let scopeMetric: JsonRecord;
      let metrics: unknown[];
      try {
        scopeMetric = record(rawScope, scopePath);
        metrics = list(
          field(scopeMetric, "metrics"),
          scopePath + ".metrics",
        );
      } catch (error) {
        issue(error, scopeLocation, true);
        return;
      }

      let scope: JsonRecord = {};
      let scopeFailed = false;
      try {
        scope = scopeContext(scopeMetric, scopePath);
      } catch (error) {
        issue(error, scopeLocation);
        scopeFailed = true;
      }

      metrics.forEach((rawMetric, metricIndex) => {
        const metricPath = scopePath + ".metrics[" + metricIndex + "]";
        const metricLocation: Location = {
          scope: "metric",
          resourceMetricsIndex,
          scopeMetricsIndex,
          metricIndex,
        };
        let metric: JsonRecord;
        let data: JsonRecord;
        let points: unknown[];
        try {
          metric = record(rawMetric, metricPath);
          const kinds = KINDS.filter((key) => present(field(metric, key)));
          if (kinds.length !== 1) {
            fail(
              metricPath,
              "must contain exactly one recognized metric data kind",
              "invalid_metric_oneof",
            );
          }
          const kind = kinds[0]!;
          if (kind !== "histogram") return;
          data = record(field(metric, kind), metricPath + ".histogram");
          points = list(
            field(data, "dataPoints"),
            metricPath + ".histogram.dataPoints",
          );
        } catch (error) {
          issue(error, metricLocation, true);
          return;
        }

        if (resourceFailed || scopeFailed) {
          result.rejectedDataPoints += points.length;
          return;
        }

        let context: ReturnType<typeof metricContext>;
        let temporality: ReturnType<typeof histogramTemporality>;
        try {
          context = metricContext(metric, metricPath);
          temporality = histogramTemporality(
            data,
            metricPath + ".histogram",
          );
        } catch (error) {
          issue(error, metricLocation);
          result.rejectedDataPoints += points.length;
          return;
        }

        points.forEach((point, dataPointIndex) => {
          const pointPath =
            metricPath + ".histogram.dataPoints[" + dataPointIndex + "]";
          try {
            result.events.push(
              normalizeHistogramPoint(
                point,
                pointPath,
                service,
                context,
                { ...resource, ...scope },
                temporality,
              ),
            );
          } catch (error) {
            issue(error, {
              ...metricLocation,
              scope: "data_point",
              dataPointIndex,
            });
            result.rejectedDataPoints++;
          }
        });
      });
    });
  });

  return result;
}
