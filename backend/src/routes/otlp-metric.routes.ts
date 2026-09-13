import compress from "@fastify/compress";

import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
} from "fastify";

import type { HistogramMetricEvent } from "../types/histogram-metric-event.js";
import type { MetricEvent } from "../types/metric-event.js";
import {
  normalizeOtlpMetricExportRequest,
  type OtlpNormalizedMetricDataPoint,
} from "../telemetry/otlp/otlp-metric-export-normalizer.js";
import {
  normalizeOtlpMetricRequest,
  OtlpMetricNormalizationError,
  type OtlpMetricNormalizationIssue,
} from "../telemetry/otlp/otlp-metric-normalizer.js";

export const DEFAULT_OTLP_METRIC_HTTP_BODY_LIMIT_BYTES =
  64 * 1024 * 1024;

export interface OtlpMetricIngestionServiceLike {
  ingest(event: MetricEvent): Promise<unknown>;
}

export interface OtlpHistogramMetricIngestionServiceLike {
  ingest(event: HistogramMetricEvent): Promise<unknown>;
}

export interface OtlpMetricRouteOptions {
  metricIngestionService: OtlpMetricIngestionServiceLike;
  histogramMetricIngestionService?: OtlpHistogramMetricIngestionServiceLike;
  explicitHistogramsEnabled?: boolean;
  bodyLimitBytes?: number;
}

interface ReceiverNormalization {
  events: OtlpNormalizedMetricDataPoint[];
  rejectedDataPoints: number;
  hasUncountableRejections: boolean;
  issues: OtlpMetricNormalizationIssue[];
}

function sendOtlpStatus(
  reply: FastifyReply,
  statusCode: number,
  message: string,
) {
  return reply
    .type("application/json")
    .code(statusCode)
    .send({ message });
}

function transportErrorMessage(error: FastifyError): string {
  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return "OTLP request body exceeds the configured decompressed size limit.";
  }

  if (error.statusCode === 415) {
    return "OTLP/HTTP JSON-only compatibility accepts Content-Type application/json with no Content-Encoding or with gzip.";
  }

  if (error.statusCode === 400) {
    return "Invalid OTLP/HTTP JSON request body.";
  }

  return "Internal Server Error";
}

function firstIssueSummary(
  issues: OtlpMetricNormalizationIssue[],
): string {
  const firstIssue = issues[0];

  return firstIssue === undefined
    ? "No validation issue was provided."
    : `${firstIssue.path}: ${firstIssue.message}`;
}

function partialSuccessMessage(
  rejectedDataPoints: number,
  issues: OtlpMetricNormalizationIssue[],
): string {
  if (rejectedDataPoints === 0) {
    return `Normalization warning. First issue: ${firstIssueSummary(issues)}`;
  }

  return (
    `Rejected ${rejectedDataPoints} invalid data ` +
    `point${rejectedDataPoints === 1 ? "" : "s"}. ` +
    `First issue: ${firstIssueSummary(issues)}`
  );
}

export async function otlpMetricRoute(
  app: FastifyInstance,
  options: OtlpMetricRouteOptions,
): Promise<void> {
  if (
    options.explicitHistogramsEnabled === true &&
    options.histogramMetricIngestionService === undefined
  ) {
    throw new Error(
      "Histogram metric ingestion service is required when explicit Histograms are enabled.",
    );
  }

  await app.register(compress, {
    globalCompression: false,
    globalDecompression: true,
    requestEncodings: ["gzip"],
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode;

    if (
      statusCode === 400 ||
      statusCode === 413 ||
      statusCode === 415
    ) {
      request.log.warn(
        {
          errorCode: error.code,
          statusCode,
        },
        "OTLP metric JSON request rejected at the transport boundary",
      );

      return sendOtlpStatus(
        reply,
        statusCode,
        transportErrorMessage(error),
      );
    }

    request.log.error(
      { err: error },
      "Unexpected OTLP metric JSON route failure",
    );

    return sendOtlpStatus(reply, 500, "Internal Server Error");
  });

  app.post<{ Body: unknown }>(
    "/otlp/v1/metrics",
    {
      bodyLimit:
        options.bodyLimitBytes ??
        DEFAULT_OTLP_METRIC_HTTP_BODY_LIMIT_BYTES,
    },
    async (request, reply) => {
      let normalization: ReceiverNormalization;

      try {
        if (options.explicitHistogramsEnabled === true) {
          const result = normalizeOtlpMetricExportRequest(request.body);
          normalization = {
            events: result.dataPoints,
            rejectedDataPoints: result.rejectedDataPoints,
            hasUncountableRejections: result.hasUncountableRejections,
            issues: result.issues,
          };
        } else {
          const result = normalizeOtlpMetricRequest(request.body);
          normalization = {
            events: result.events.map((event) => ({
              kind: "scalar",
              event,
            })),
            rejectedDataPoints: result.rejectedDataPoints,
            hasUncountableRejections: result.hasUncountableRejections,
            issues: result.issues,
          };
        }
      } catch (error) {
        if (error instanceof OtlpMetricNormalizationError) {
          request.log.warn(
            {
              code: error.code,
              path: error.path,
              message: error.reason,
            },
            "OTLP metric request failed envelope validation",
          );

          return sendOtlpStatus(
            reply,
            400,
            `Invalid OTLP metric request: ${error.path}: ${error.reason}`,
          );
        }

        throw error;
      }

      const normalizedScalarDataPoints = normalization.events.filter(
        (dataPoint) => dataPoint.kind === "scalar",
      ).length;
      const normalizedHistogramDataPoints =
        normalization.events.length - normalizedScalarDataPoints;

      if (normalization.hasUncountableRejections) {
        request.log.warn(
          {
            normalizedDataPoints: normalization.events.length,
            normalizedScalarDataPoints,
            normalizedHistogramDataPoints,
            rejectedDataPoints: normalization.rejectedDataPoints,
            hasUncountableRejections: true,
            issues: normalization.issues,
          },
          "OTLP metric batch rejected because its rejected-point count is unknowable",
        );

        return sendOtlpStatus(
          reply,
          400,
          "Invalid OTLP metric request: the complete rejected data point count could not be determined. " +
            `First issue: ${firstIssueSummary(normalization.issues)}`,
        );
      }

      if (
        normalization.events.length === 0 &&
        normalization.rejectedDataPoints > 0
      ) {
        request.log.warn(
          {
            normalizedDataPoints: 0,
            normalizedScalarDataPoints,
            normalizedHistogramDataPoints,
            rejectedDataPoints: normalization.rejectedDataPoints,
            hasUncountableRejections: false,
            issues: normalization.issues,
          },
          "OTLP metric batch contained no valid data points",
        );

        return sendOtlpStatus(
          reply,
          400,
          "OTLP metric request contained no valid data points. " +
            `First issue: ${firstIssueSummary(normalization.issues)}`,
        );
      }

      let publishedDataPoints = 0;
      let publishedScalarDataPoints = 0;
      let publishedHistogramDataPoints = 0;

      try {
        for (const dataPoint of normalization.events) {
          if (dataPoint.kind === "scalar") {
            await options.metricIngestionService.ingest(dataPoint.event);
            publishedScalarDataPoints++;
          } else {
            await options.histogramMetricIngestionService!.ingest(
              dataPoint.event,
            );
            publishedHistogramDataPoints++;
          }
          publishedDataPoints++;
        }
      } catch (error) {
        request.log.error(
          {
            err: error,
            normalizedDataPoints: normalization.events.length,
            normalizedScalarDataPoints,
            normalizedHistogramDataPoints,
            publishedScalarDataPoints,
            publishedHistogramDataPoints,
            publishedDataPoints,
            rejectedDataPoints: normalization.rejectedDataPoints,
          },
          "OTLP metric publishing failed",
        );

        return sendOtlpStatus(
          reply,
          503,
          "Metric ingestion is temporarily unavailable.",
        );
      }

      if (normalization.issues.length > 0) {
        const errorMessage = partialSuccessMessage(
          normalization.rejectedDataPoints,
          normalization.issues,
        );

        request.log.warn(
          {
            acceptedDataPoints: normalization.events.length,
            acceptedScalarDataPoints: normalizedScalarDataPoints,
            acceptedHistogramDataPoints: normalizedHistogramDataPoints,
            rejectedDataPoints: normalization.rejectedDataPoints,
            issues: normalization.issues,
          },
          "OTLP metric batch accepted with partial success or warnings",
        );

        return reply
          .type("application/json")
          .code(200)
          .send({
            partialSuccess: {
              rejectedDataPoints: String(
                normalization.rejectedDataPoints,
              ),
              errorMessage,
            },
          });
      }

      return reply.type("application/json").code(200).send({});
    },
  );
}
