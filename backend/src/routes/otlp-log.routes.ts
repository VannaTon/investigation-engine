import compress from "@fastify/compress";

import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
} from "fastify";

import {
  normalizeOtlpLogRequest,
  OtlpLogNormalizationError,
  type OtlpLogNormalizationIssue,
} from "../telemetry/otlp/otlp-log-normalizer.js";
import type { LogEvent } from "../types/log-event.js";
import {
  ensureApplicationIdentityDecorator,
  ingestionAuthenticationHook,
  trustedApplicationId,
  type IngestionAuthenticator,
} from "./ingestion-auth.js";
import type { ApplicationTelemetry } from "../types/application.js";

export const DEFAULT_OTLP_LOG_HTTP_BODY_LIMIT_BYTES =
  64 * 1024 * 1024;

export interface OtlpLogIngestionServiceLike {
  ingest(event: ApplicationTelemetry<LogEvent>): Promise<unknown>;
}

export interface OtlpLogRouteOptions {
  logIngestionService: OtlpLogIngestionServiceLike;
  authenticator: IngestionAuthenticator;
  bodyLimitBytes?: number;
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
  issues: OtlpLogNormalizationIssue[],
): string {
  const firstIssue = issues[0];

  return firstIssue === undefined
    ? "No validation issue was provided."
    : firstIssue.path + ": " + firstIssue.message;
}

function partialSuccessMessage(
  rejectedLogRecords: number,
  issues: OtlpLogNormalizationIssue[],
): string {
  if (rejectedLogRecords === 0) {
    return (
      "Normalization warning. First issue: " +
      firstIssueSummary(issues)
    );
  }

  return (
    "Rejected " +
    rejectedLogRecords +
    " invalid log record" +
    (rejectedLogRecords === 1 ? "" : "s") +
    ". First issue: " +
    firstIssueSummary(issues)
  );
}

export async function otlpLogRoute(
  app: FastifyInstance,
  options: OtlpLogRouteOptions,
): Promise<void> {
  ensureApplicationIdentityDecorator(app);
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
        "OTLP log JSON request rejected at the transport boundary",
      );

      return sendOtlpStatus(
        reply,
        statusCode,
        transportErrorMessage(error),
      );
    }

    request.log.error(
      { err: error },
      "Unexpected OTLP log JSON route failure",
    );

    return sendOtlpStatus(reply, 500, "Internal Server Error");
  });

  app.post<{ Body: unknown }>(
    "/otlp/v1/logs",
    {
      bodyLimit:
        options.bodyLimitBytes ??
        DEFAULT_OTLP_LOG_HTTP_BODY_LIMIT_BYTES,
      onRequest: ingestionAuthenticationHook(options.authenticator),
    },
    async (request, reply) => {
      const applicationId = trustedApplicationId(request);
      let normalization;

      try {
        normalization = normalizeOtlpLogRequest(request.body);
      } catch (error) {
        if (error instanceof OtlpLogNormalizationError) {
          request.log.warn(
            {
              code: error.code,
              path: error.path,
              message: error.reason,
            },
            "OTLP log request failed envelope validation",
          );

          return sendOtlpStatus(
            reply,
            400,
            "Invalid OTLP log request: " +
              error.path +
              ": " +
              error.reason,
          );
        }

        throw error;
      }

      if (normalization.hasUncountableRejections) {
        request.log.warn(
          {
            normalizedLogRecords: normalization.events.length,
            rejectedLogRecords: normalization.rejectedLogRecords,
            hasUncountableRejections: true,
            issues: normalization.issues,
          },
          "OTLP log batch rejected because its rejected-record count is unknowable",
        );

        return sendOtlpStatus(
          reply,
          400,
          "Invalid OTLP log request: the complete rejected log record count could not be determined. " +
            "First issue: " +
            firstIssueSummary(normalization.issues),
        );
      }

      if (
        normalization.events.length === 0 &&
        normalization.rejectedLogRecords > 0
      ) {
        request.log.warn(
          {
            normalizedLogRecords: 0,
            rejectedLogRecords: normalization.rejectedLogRecords,
            hasUncountableRejections: false,
            issues: normalization.issues,
          },
          "OTLP log batch contained no valid log records",
        );

        return sendOtlpStatus(
          reply,
          400,
          "OTLP log request contained no valid log records. " +
            "First issue: " +
            firstIssueSummary(normalization.issues),
        );
      }

      let publishedLogRecords = 0;

      try {
        for (const event of normalization.events) {
          await options.logIngestionService.ingest({
            ...event,
            applicationId,
          });
          publishedLogRecords++;
        }
      } catch (error) {
        request.log.error(
          {
            err: error,
            normalizedLogRecords: normalization.events.length,
            publishedLogRecords,
            rejectedLogRecords: normalization.rejectedLogRecords,
          },
          "OTLP log publishing failed",
        );

        return sendOtlpStatus(
          reply,
          503,
          "Log ingestion is temporarily unavailable.",
        );
      }

      if (normalization.issues.length > 0) {
        const errorMessage = partialSuccessMessage(
          normalization.rejectedLogRecords,
          normalization.issues,
        );

        request.log.warn(
          {
            acceptedLogRecords: normalization.events.length,
            rejectedLogRecords: normalization.rejectedLogRecords,
            issues: normalization.issues,
          },
          "OTLP log batch accepted with partial success or warnings",
        );

        return reply
          .type("application/json")
          .code(200)
          .send({
            partialSuccess: {
              rejectedLogRecords: String(
                normalization.rejectedLogRecords,
              ),
              errorMessage,
            },
          });
      }

      return reply.type("application/json").code(200).send({});
    },
  );
}
