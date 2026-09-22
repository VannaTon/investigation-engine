import compress from "@fastify/compress";

import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
} from "fastify";

import type { SpanIngestionService } from "../services/span-ingestion.service.js";
import {
  normalizeOtlpTraceRequest,
  OtlpTraceNormalizationError,
} from "../telemetry/otlp/otlp-trace-normalizer.js";
import {
  ensureApplicationIdentityDecorator,
  ingestionAuthenticationHook,
  trustedApplicationId,
  type IngestionAuthenticator,
} from "./ingestion-auth.js";

export const DEFAULT_OTLP_HTTP_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

export type OtlpSpanIngestionServiceLike = Pick<
  SpanIngestionService,
  "ingest"
>;

export interface OtlpTraceRouteOptions {
  spanIngestionService: OtlpSpanIngestionServiceLike;
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
  issues: Array<{ path: string; message: string }>,
): string {
  const firstIssue = issues[0];

  return firstIssue === undefined
    ? "No validation issue was provided."
    : `${firstIssue.path}: ${firstIssue.message}`;
}

export async function otlpTraceRoute(
  app: FastifyInstance,
  options: OtlpTraceRouteOptions,
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
        "OTLP/HTTP JSON request rejected at the transport boundary",
      );

      return sendOtlpStatus(
        reply,
        statusCode,
        transportErrorMessage(error),
      );
    }

    request.log.error(
      { err: error },
      "Unexpected OTLP/HTTP JSON route failure",
    );

    return sendOtlpStatus(reply, 500, "Internal Server Error");
  });

  app.post<{ Body: unknown }>(
    "/v1/traces",
    {
      bodyLimit:
        options.bodyLimitBytes ?? DEFAULT_OTLP_HTTP_BODY_LIMIT_BYTES,
      onRequest: ingestionAuthenticationHook(options.authenticator),
    },
    async (request, reply) => {
      const applicationId = trustedApplicationId(request);
      let normalization;

      try {
        normalization = normalizeOtlpTraceRequest(request.body);
      } catch (error) {
        if (error instanceof OtlpTraceNormalizationError) {
          request.log.warn(
            {
              path: error.path,
              message: error.reason,
            },
            "OTLP trace request failed envelope validation",
          );

          return sendOtlpStatus(
            reply,
            400,
            `Invalid OTLP trace request: ${error.path}: ${error.reason}`,
          );
        }

        throw error;
      }

      if (
        normalization.spans.length === 0 &&
        normalization.rejectedSpans > 0
      ) {
        request.log.warn(
          {
            rejectedSpans: normalization.rejectedSpans,
            issues: normalization.issues,
          },
          "OTLP trace batch rejected during normalization",
        );

        return sendOtlpStatus(
          reply,
          400,
          `OTLP trace request contained no valid spans. First issue: ${firstIssueSummary(
            normalization.issues,
          )}`,
        );
      }

      try {
        for (const span of normalization.spans) {
          await options.spanIngestionService.ingest({
            ...span,
            applicationId,
          });
        }
      } catch (error) {
        request.log.error(
          {
            err: error,
            normalizedSpans: normalization.spans.length,
            rejectedSpans: normalization.rejectedSpans,
          },
          "OTLP trace publishing failed",
        );

        return sendOtlpStatus(
          reply,
          503,
          "Trace ingestion is temporarily unavailable.",
        );
      }

      if (normalization.rejectedSpans > 0) {
        const errorMessage =
          `Rejected ${normalization.rejectedSpans} invalid ` +
          `span${normalization.rejectedSpans === 1 ? "" : "s"}. ` +
          `First issue: ${firstIssueSummary(normalization.issues)}`;

        request.log.warn(
          {
            acceptedSpans: normalization.spans.length,
            rejectedSpans: normalization.rejectedSpans,
            issues: normalization.issues,
          },
          "OTLP trace batch partially accepted",
        );

        return reply
          .type("application/json")
          .code(200)
          .send({
            partialSuccess: {
              rejectedSpans: String(normalization.rejectedSpans),
              errorMessage,
            },
          });
      }

      return reply.type("application/json").code(200).send({});
    },
  );
}
