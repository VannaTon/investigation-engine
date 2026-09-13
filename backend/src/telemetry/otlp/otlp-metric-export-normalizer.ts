import type { HistogramMetricEvent } from "../../types/histogram-metric-event.js";
import type { MetricEvent } from "../../types/metric-event.js";
import {
  histogramTemporality,
  normalizeHistogramPoint,
} from "./otlp-explicit-histogram-normalizer.js";
import {
  OtlpMetricNormalizationError,
  normalizePoint,
  otlpMetricNormalizationHelpers,
  validateCumulativeMonotonicSum,
  type OtlpMetricNormalizationIssue,
} from "./otlp-metric-normalizer.js";

type JsonRecord = Record<string, unknown>;
type MetricKind =
  | "gauge"
  | "sum"
  | "histogram"
  | "exponentialHistogram"
  | "summary";

const KINDS: MetricKind[] = [
  "gauge",
  "sum",
  "histogram",
  "exponentialHistogram",
  "summary",
];

const {
  fail,
  field,
  list,
  metricContext,
  present,
  record,
  resourceContext,
  scopeContext,
} = otlpMetricNormalizationHelpers;

export type OtlpNormalizedMetricDataPoint =
  | {
      kind: "scalar";
      event: MetricEvent;
    }
  | {
      kind: "histogram";
      event: HistogramMetricEvent;
    };

export interface OtlpMetricExportNormalizationResult {
  dataPoints: OtlpNormalizedMetricDataPoint[];
  rejectedDataPoints: number;
  hasUncountableRejections: boolean;
  issues: OtlpMetricNormalizationIssue[];
}

type IssueLocation = Omit<
  OtlpMetricNormalizationIssue,
  "code" | "path" | "message"
>;

export function normalizeOtlpMetricExportRequest(
  request: unknown,
): OtlpMetricExportNormalizationResult {
  const root = record(request, "request");
  const resources = list(field(root, "resourceMetrics"), "resourceMetrics");
  const result: OtlpMetricExportNormalizationResult = {
    dataPoints: [],
    rejectedDataPoints: 0,
    hasUncountableRejections: false,
    issues: [],
  };

  function issue(
    error: unknown,
    location: IssueLocation,
    uncountable = false,
  ): void {
    if (!(error instanceof OtlpMetricNormalizationError)) throw error;

    result.issues.push({
      code: error.code,
      path: error.path,
      message: error.reason,
      ...location,
    });

    if (uncountable) {
      result.hasUncountableRejections = true;
    }
  }

  resources.forEach((rawResource, resourceMetricsIndex) => {
    const resourcePath = "resourceMetrics[" + resourceMetricsIndex + "]";
    const resourceLocation: IssueLocation = {
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
      const scopeLocation: IssueLocation = {
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
        const metricLocation: IssueLocation = {
          scope: "metric",
          resourceMetricsIndex,
          scopeMetricsIndex,
          metricIndex,
        };
        let metric: JsonRecord;
        let data: JsonRecord;
        let kind: MetricKind;
        let points: unknown[];

        try {
          metric = record(rawMetric, metricPath);
          const kinds = KINDS.filter((candidate) =>
            present(field(metric, candidate)),
          );

          if (kinds.length !== 1) {
            fail(
              metricPath,
              "must contain exactly one recognized metric data kind",
              "invalid_metric_oneof",
            );
          }

          kind = kinds[0]!;
          data = record(field(metric, kind), metricPath + "." + kind);
          points = list(
            field(data, "dataPoints"),
            metricPath + "." + kind + ".dataPoints",
          );
        } catch (error) {
          issue(error, metricLocation, true);
          return;
        }

        if (kind === "exponentialHistogram" || kind === "summary") {
          issue(
            new OtlpMetricNormalizationError(
              metricPath + "." + kind,
              "Phase 5F2 supports Gauge, cumulative monotonic Sum, " +
                "and explicit Histogram metrics only",
              "unsupported_metric_type",
            ),
            metricLocation,
          );
          result.rejectedDataPoints += points.length;
          return;
        }

        if (resourceFailed || scopeFailed) {
          result.rejectedDataPoints += points.length;
          return;
        }

        let context: ReturnType<typeof metricContext>;
        let temporality:
          | ReturnType<typeof histogramTemporality>
          | undefined;

        try {
          context = metricContext(metric, metricPath);

          if (kind === "sum") {
            validateCumulativeMonotonicSum(
              data,
              metricPath + ".sum",
            );
          } else if (kind === "histogram") {
            temporality = histogramTemporality(
              data,
              metricPath + ".histogram",
            );
          }
        } catch (error) {
          issue(error, metricLocation);
          result.rejectedDataPoints += points.length;
          return;
        }

        points.forEach((point, dataPointIndex) => {
          const pointPath =
            metricPath +
            "." +
            kind +
            ".dataPoints[" +
            dataPointIndex +
            "]";

          try {
            if (kind === "histogram") {
              result.dataPoints.push({
                kind: "histogram",
                event: normalizeHistogramPoint(
                  point,
                  pointPath,
                  service,
                  context,
                  { ...resource, ...scope },
                  temporality!,
                ),
              });
              return;
            }

            result.dataPoints.push({
              kind: "scalar",
              event: normalizePoint(
                point,
                pointPath,
                service,
                context,
                { ...resource, ...scope },
                kind,
              ),
            });
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
