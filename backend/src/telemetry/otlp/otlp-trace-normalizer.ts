import type { Span } from "../../types/span.js";

const TRACE_ID_LENGTH = 32;
const SPAN_ID_LENGTH = 16;
const NANOS_PER_MILLISECOND = 1_000_000n;
const UINT32_MAX_MILLISECONDS = 4_294_967_295n;
const UNKNOWN_SERVICE = "unknown_service";

type JsonRecord = Record<string, unknown>;

export class OtlpTraceNormalizationError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = "OtlpTraceNormalizationError";
  }
}

export interface OtlpTraceNormalizationIssue {
  path: string;
  message: string;
  resourceSpansIndex: number;
  scopeSpansIndex: number;
  spanIndex: number;
}

export interface OtlpTraceNormalizationResult {
  spans: Span[];
  rejectedSpans: number;
  issues: OtlpTraceNormalizationIssue[];
}

function fail(path: string, message: string): never {
  throw new OtlpTraceNormalizationError(path, message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  return value;
}

function readOptionalRecord(
  record: JsonRecord,
  key: string,
  path: string,
): JsonRecord | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  return readRecord(value, `${path}.${key}`);
}

function readOptionalArray(
  record: JsonRecord,
  key: string,
  path: string,
): unknown[] {
  const value = record[key];

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    fail(`${path}.${key}`, "must be an array");
  }

  return value;
}

function readRequiredString(
  record: JsonRecord,
  key: string,
  path: string,
): string {
  const value = record[key];

  if (typeof value !== "string") {
    fail(`${path}.${key}`, "must be a string");
  }

  return value;
}

function normalizeId(
  value: unknown,
  path: string,
  expectedLength: number,
): string {
  if (typeof value !== "string") {
    fail(path, "must be a hexadecimal string");
  }

  if (
    value.length !== expectedLength ||
    !/^[0-9a-fA-F]+$/.test(value) ||
    /^0+$/.test(value)
  ) {
    fail(
      path,
      `must be a non-zero ${expectedLength}-character hexadecimal string`,
    );
  }

  return value.toLowerCase();
}

function parseUnixNano(value: unknown, path: string): bigint {
  if (typeof value === "string") {
    if (!/^\d+$/.test(value)) {
      fail(path, "must be a non-negative decimal integer");
    }

    return BigInt(value);
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return BigInt(value);
  }

  fail(path, "must be a non-negative decimal integer");
}

function unixNanoToIso(value: bigint, path: string): string {
  const milliseconds = value / NANOS_PER_MILLISECOND;

  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(path, "is outside the supported timestamp range");
  }

  const date = new Date(Number(milliseconds));

  if (Number.isNaN(date.getTime())) {
    fail(path, "is outside the supported timestamp range");
  }

  return date.toISOString();
}

function durationMilliseconds(
  start: bigint,
  end: bigint,
  path: string,
): number {
  if (end < start) {
    fail(path, "must be greater than or equal to startTimeUnixNano");
  }

  const durationNanos = end - start;
  const wholeMilliseconds = durationNanos / NANOS_PER_MILLISECOND;

  if (wholeMilliseconds > UINT32_MAX_MILLISECONDS) {
    fail(
      path,
      `produces a duration greater than the UInt32 maximum of ${UINT32_MAX_MILLISECONDS} milliseconds`,
    );
  }

  return Number(wholeMilliseconds);
}

function decodeIntValue(value: unknown, path: string): number | string {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value)
  ) {
    return value;
  }

  if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
    fail(path, "must be a decimal integer");
  }

  const parsed = BigInt(value);

  if (
    parsed >= BigInt(Number.MIN_SAFE_INTEGER) &&
    parsed <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(parsed);
  }

  return value;
}

function decodeAnyValue(value: unknown, path: string): unknown {
  const record = readRecord(value, path);
  const variants = [
    "stringValue",
    "boolValue",
    "intValue",
    "doubleValue",
    "arrayValue",
    "kvlistValue",
    "bytesValue",
  ].filter((key) => Object.prototype.hasOwnProperty.call(record, key));

  if (variants.length !== 1) {
    fail(path, "must contain exactly one OTLP AnyValue field");
  }

  const variant = variants[0];

  if (variant === undefined) {
    fail(path, "must contain an OTLP AnyValue field");
  }

  const variantPath = `${path}.${variant}`;
  const variantValue = record[variant];

  switch (variant) {
    case "stringValue":
      if (typeof variantValue !== "string") {
        fail(variantPath, "must be a string");
      }
      return variantValue;

    case "boolValue":
      if (typeof variantValue !== "boolean") {
        fail(variantPath, "must be a boolean");
      }
      return variantValue;

    case "intValue":
      return decodeIntValue(variantValue, variantPath);

    case "doubleValue":
      if (typeof variantValue === "number" && Number.isFinite(variantValue)) {
        return variantValue;
      }
      if (
        variantValue === "NaN" ||
        variantValue === "Infinity" ||
        variantValue === "-Infinity"
      ) {
        return variantValue;
      }
      fail(variantPath, "must be a finite number or protobuf special value");

    case "bytesValue":
      if (typeof variantValue !== "string") {
        fail(variantPath, "must be a base64 string");
      }
      return variantValue;

    case "arrayValue": {
      const arrayRecord = readRecord(variantValue, variantPath);
      const values = readOptionalArray(arrayRecord, "values", variantPath);

      return values.map((item, index) =>
        decodeAnyValue(item, `${variantPath}.values[${index}]`),
      );
    }

    case "kvlistValue": {
      const listRecord = readRecord(variantValue, variantPath);
      return decodeAttributes(
        readOptionalArray(listRecord, "values", variantPath),
        `${variantPath}.values`,
      );
    }
  }
}

function decodeAttributes(
  attributes: unknown[],
  path: string,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};

  attributes.forEach((attribute, index) => {
    const attributePath = `${path}[${index}]`;
    const record = readRecord(attribute, attributePath);
    const key = readRequiredString(record, "key", attributePath);

    if (record.value === undefined) {
      fail(`${attributePath}.value`, "is required");
    }

    decoded[key] = decodeAnyValue(record.value, `${attributePath}.value`);
  });

  return decoded;
}

function normalizeStatus(span: JsonRecord, path: string): Span["status"] {
  const status = readOptionalRecord(span, "status", path);

  if (status === undefined || status.code === undefined) {
    return "ok";
  }

  if (typeof status.code !== "number" || !Number.isInteger(status.code)) {
    fail(`${path}.status.code`, "must be an integer enum value");
  }

  switch (status.code) {
    case 0:
    case 1:
      return "ok";
    case 2:
      return "error";
    default:
      fail(
        `${path}.status.code`,
        `unsupported OTLP status code ${status.code}`,
      );
  }
}

function normalizeSpan(
  spanValue: unknown,
  resourceAttributes: Record<string, unknown>,
  service: string,
  path: string,
): Span {
  const span = readRecord(spanValue, path);
  const traceId = normalizeId(span.traceId, `${path}.traceId`, TRACE_ID_LENGTH);
  const spanId = normalizeId(span.spanId, `${path}.spanId`, SPAN_ID_LENGTH);

  let parentSpanId: string | undefined;
  if (span.parentSpanId !== undefined && span.parentSpanId !== "") {
    parentSpanId = normalizeId(
      span.parentSpanId,
      `${path}.parentSpanId`,
      SPAN_ID_LENGTH,
    );
  }

  const startTimeUnixNano = parseUnixNano(
    span.startTimeUnixNano,
    `${path}.startTimeUnixNano`,
  );
  const endTimeUnixNano = parseUnixNano(
    span.endTimeUnixNano,
    `${path}.endTimeUnixNano`,
  );
  const spanAttributes = decodeAttributes(
    readOptionalArray(span, "attributes", path),
    `${path}.attributes`,
  );

  const normalized: Span = {
    traceId,
    spanId,
    service,
    operation: readRequiredString(span, "name", path),
    startTime: unixNanoToIso(startTimeUnixNano, `${path}.startTimeUnixNano`),
    endTime: unixNanoToIso(endTimeUnixNano, `${path}.endTimeUnixNano`),
    durationMs: durationMilliseconds(
      startTimeUnixNano,
      endTimeUnixNano,
      `${path}.endTimeUnixNano`,
    ),
    status: normalizeStatus(span, path),
    metadata: {
      otel: {
        resourceAttributes,
        spanAttributes,
      },
    },
  };

  if (parentSpanId !== undefined) {
    normalized.parentSpanId = parentSpanId;
  }

  return normalized;
}

function normalizationIssue(
  error: OtlpTraceNormalizationError,
  resourceSpansIndex: number,
  scopeSpansIndex: number,
  spanIndex: number,
): OtlpTraceNormalizationIssue {
  return {
    path: error.path,
    message: error.reason,
    resourceSpansIndex,
    scopeSpansIndex,
    spanIndex,
  };
}

function asNormalizationError(error: unknown): OtlpTraceNormalizationError {
  if (error instanceof OtlpTraceNormalizationError) {
    return error;
  }

  throw error;
}

export function normalizeOtlpTraceRequest(
  request: unknown,
): OtlpTraceNormalizationResult {
  const requestRecord = readRecord(request, "request");
  const resourceSpans = readOptionalArray(
    requestRecord,
    "resourceSpans",
    "request",
  );
  const normalized: Span[] = [];
  const issues: OtlpTraceNormalizationIssue[] = [];

  resourceSpans.forEach((resourceSpansValue, resourceIndex) => {
    const resourcePath = `resourceSpans[${resourceIndex}]`;
    const resourceSpansRecord = readRecord(resourceSpansValue, resourcePath);
    let resourceAttributes: Record<string, unknown> = {};
    let service = UNKNOWN_SERVICE;
    let resourceError: OtlpTraceNormalizationError | undefined;

    try {
      const resource = readOptionalRecord(
        resourceSpansRecord,
        "resource",
        resourcePath,
      );
      resourceAttributes = decodeAttributes(
        resource === undefined
          ? []
          : readOptionalArray(
              resource,
              "attributes",
              `${resourcePath}.resource`,
            ),
        `${resourcePath}.resource.attributes`,
      );
      const configuredService = resourceAttributes["service.name"];
      service =
        typeof configuredService === "string" &&
        configuredService.trim().length > 0
          ? configuredService
          : UNKNOWN_SERVICE;
    } catch (error) {
      resourceError = asNormalizationError(error);
    }

    const scopeSpans = readOptionalArray(
      resourceSpansRecord,
      "scopeSpans",
      resourcePath,
    );

    scopeSpans.forEach((scopeSpansValue, scopeIndex) => {
      const scopePath = `${resourcePath}.scopeSpans[${scopeIndex}]`;
      const scopeSpansRecord = readRecord(scopeSpansValue, scopePath);
      const spans = readOptionalArray(scopeSpansRecord, "spans", scopePath);

      spans.forEach((spanValue, spanIndex) => {
        if (resourceError !== undefined) {
          issues.push(
            normalizationIssue(
              resourceError,
              resourceIndex,
              scopeIndex,
              spanIndex,
            ),
          );
          return;
        }

        try {
          normalized.push(
            normalizeSpan(
              spanValue,
              resourceAttributes,
              service,
              `${scopePath}.spans[${spanIndex}]`,
            ),
          );
        } catch (error) {
          issues.push(
            normalizationIssue(
              asNormalizationError(error),
              resourceIndex,
              scopeIndex,
              spanIndex,
            ),
          );
        }
      });
    });
  });

  return {
    spans: normalized,
    rejectedSpans: issues.length,
    issues,
  };
}
