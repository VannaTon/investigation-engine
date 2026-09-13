import { Buffer } from "node:buffer";
import type { LogEvent } from "../../types/log-event.js";

type JsonRecord = Record<string, unknown>;
type IssueScope = "resource" | "scope" | "log_record";
type IssueSeverity = "error" | "warning";

export const OTLP_LOG_LIMITS = Object.freeze({
  metadataBytes: 65_536,
  attributeDepth: 16,
  attributeValues: 4_096,
  attributesPerContainer: 256,
});

const UINT64_MAX = (1n << 64n) - 1n;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const NANOS_PER_MILLISECOND = 1_000_000n;
const UNKNOWN_SERVICE = "unknown_service";
const TRACE_ID_LENGTH = 32;
const SPAN_ID_LENGTH = 16;
const ANY_VALUE_FIELDS = [
  "stringValue",
  "boolValue",
  "intValue",
  "doubleValue",
  "arrayValue",
  "kvlistValue",
  "bytesValue",
] as const;

export class OtlpLogNormalizationError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
    readonly code = "invalid_field",
  ) {
    super(path + ": " + reason);
    this.name = "OtlpLogNormalizationError";
  }
}

export interface OtlpLogNormalizationIssue {
  code: string;
  path: string;
  message: string;
  severity: IssueSeverity;
  scope: IssueScope;
  resourceLogsIndex: number;
  scopeLogsIndex?: number;
  logRecordIndex?: number;
}

export interface OtlpLogNormalizationResult {
  events: LogEvent[];
  /** Counts known rejected records once per record, not once per issue. */
  rejectedLogRecords: number;
  /** A malformed container prevented an exact rejected-record count. */
  hasUncountableRejections: boolean;
  issues: OtlpLogNormalizationIssue[];
}

interface Budget {
  values: number;
}

interface LocalWarning {
  code: string;
  path: string;
  message: string;
}

function fail(path: string, reason: string, code = "invalid_field"): never {
  throw new OtlpLogNormalizationError(path, reason, code);
}

function field(value: JsonRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key)
    ? value[key]
    : undefined;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as JsonRecord;
}

function optionalRecord(value: unknown, path: string): JsonRecord {
  return present(value) ? record(value, path) : {};
}

function list(value: unknown, path: string): unknown[] {
  if (!present(value)) return [];
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "must be a string");
  return value;
}

function optionalText(value: unknown, path: string): string | undefined {
  return present(value) ? text(value, path) : undefined;
}

function integer(
  value: unknown,
  path: string,
  minimum: bigint,
  maximum: bigint,
): bigint {
  let parsed: bigint;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const digits = value.replace(/^-?0*/, "");
    if (digits.length > 20) {
      fail(path, "is outside the supported integer range");
    }
    parsed = BigInt((value.startsWith("-") ? "-" : "") + (digits || "0"));
  } else {
    fail(path, "must be a decimal integer string or safe integer number");
  }
  if (parsed < minimum || parsed > maximum) {
    fail(path, "is outside the supported integer range");
  }
  return parsed;
}

function unsigned(value: unknown, path: string): bigint {
  return integer(value, path, 0n, UINT64_MAX);
}

function uint32(value: unknown, path: string): number {
  return present(value)
    ? Number(integer(value, path, 0n, 4_294_967_295n))
    : 0;
}

function finiteDouble(value: unknown, path: string): number {
  if (
    typeof value === "string" &&
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  ) {
    value = Number(value);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "must be a finite double or protobuf special value");
  }
  return value;
}

function consume(budget: Budget, depth: number, path: string): void {
  budget.values++;
  if (
    budget.values > OTLP_LOG_LIMITS.attributeValues ||
    depth > OTLP_LOG_LIMITS.attributeDepth
  ) {
    fail(
      path,
      "exceeds the attribute complexity limit",
      "metadata_limit_exceeded",
    );
  }
}

function attributes(
  value: unknown,
  path: string,
  budget: Budget,
  depth = 0,
): JsonRecord {
  const entries = list(value, path);
  if (entries.length > OTLP_LOG_LIMITS.attributesPerContainer) {
    fail(path, "exceeds the attribute count limit", "metadata_limit_exceeded");
  }
  const result: JsonRecord = {};
  entries.forEach((entry, index) => {
    const entryPath = path + "[" + index + "]";
    const item = record(entry, entryPath);
    const key = text(field(item, "key"), entryPath + ".key");
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      fail(entryPath + ".key", "duplicate attribute key", "duplicate_attribute");
    }
    if (!present(field(item, "value"))) {
      fail(entryPath + ".value", "is required");
    }
    const decoded = anyValue(
      field(item, "value"),
      entryPath + ".value",
      budget,
      depth,
    );
    Object.defineProperty(result, key, {
      value: decoded,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  });
  return result;
}

function validBase64(value: string): boolean {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const bare = normalized.replace(/=+$/, "");
  return (
    /^[A-Za-z0-9+/]*={0,2}$/.test(normalized) &&
    bare.length % 4 !== 1 &&
    (!normalized.includes("=") || normalized.length % 4 === 0) &&
    Buffer.from(normalized, "base64")
      .toString("base64")
      .replace(/=+$/, "") === bare
  );
}

function anyValue(
  value: unknown,
  path: string,
  budget: Budget,
  depth: number,
): unknown {
  consume(budget, depth, path);
  const item = record(value, path);
  const keys = ANY_VALUE_FIELDS.filter((key) => present(field(item, key)));
  if (keys.length === 0) return null;
  if (keys.length !== 1) {
    fail(path, "must contain at most one AnyValue field");
  }
  const key = keys[0]!;
  const raw = field(item, key);
  const valuePath = path + "." + key;
  switch (key) {
    case "stringValue": {
      const result = text(raw, valuePath);
      if (Buffer.byteLength(result) > OTLP_LOG_LIMITS.metadataBytes) {
        fail(
          valuePath,
          "exceeds the metadata byte limit",
          "metadata_limit_exceeded",
        );
      }
      return result;
    }
    case "boolValue":
      if (typeof raw !== "boolean") fail(valuePath, "must be a boolean");
      return raw;
    case "intValue": {
      const parsed = integer(raw, valuePath, INT64_MIN, INT64_MAX);
      return parsed >= SAFE_MIN && parsed <= SAFE_MAX
        ? Number(parsed)
        : parsed.toString();
    }
    case "doubleValue":
      return raw === "NaN" || raw === "Infinity" || raw === "-Infinity"
        ? raw
        : finiteDouble(raw, valuePath);
    case "bytesValue": {
      const encoded = text(raw, valuePath);
      if (encoded.length > OTLP_LOG_LIMITS.metadataBytes) {
        fail(
          valuePath,
          "exceeds the metadata byte limit",
          "metadata_limit_exceeded",
        );
      }
      if (!validBase64(encoded)) {
        fail(valuePath, "must be a valid base64 string");
      }
      return encoded;
    }
    case "arrayValue": {
      const array = record(raw, valuePath);
      const values = list(field(array, "values"), valuePath + ".values");
      if (values.length > OTLP_LOG_LIMITS.attributeValues) {
        fail(
          valuePath,
          "exceeds the attribute complexity limit",
          "metadata_limit_exceeded",
        );
      }
      return values.map((child, index) =>
        anyValue(
          child,
          valuePath + ".values[" + index + "]",
          budget,
          depth + 1,
        ),
      );
    }
    case "kvlistValue": {
      const keyValues = record(raw, valuePath);
      return attributes(
        field(keyValues, "values"),
        valuePath + ".values",
        budget,
        depth + 1,
      );
    }
  }
}

function byteLimit(value: unknown, path: string): void {
  if (
    Buffer.byteLength(JSON.stringify(value), "utf8") >
    OTLP_LOG_LIMITS.metadataBytes
  ) {
    fail(
      path,
      "exceeds the normalized metadata byte limit",
      "metadata_limit_exceeded",
    );
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  const stable: JsonRecord = {};
  Object.keys(value as JsonRecord)
    .sort()
    .forEach((key) => {
      Object.defineProperty(stable, key, {
        value: stableValue((value as JsonRecord)[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    });
  return stable;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function resourceContext(resourceLogs: JsonRecord, path: string): JsonRecord {
  const resource = optionalRecord(
    field(resourceLogs, "resource"),
    path + ".resource",
  );
  const result: JsonRecord = {
    resourceAttributes: attributes(
      field(resource, "attributes"),
      path + ".resource.attributes",
      { values: 0 },
    ),
  };
  const schemaUrl = optionalText(
    field(resourceLogs, "schemaUrl"),
    path + ".schemaUrl",
  );
  if (schemaUrl !== undefined) result.resourceSchemaUrl = schemaUrl;
  if (present(field(resource, "droppedAttributesCount"))) {
    result.resourceDroppedAttributesCount = uint32(
      field(resource, "droppedAttributesCount"),
      path + ".resource.droppedAttributesCount",
    );
  }
  byteLimit(result, path + ".resource");
  return result;
}

function scopeContext(scopeLogs: JsonRecord, path: string): JsonRecord {
  const scope = optionalRecord(field(scopeLogs, "scope"), path + ".scope");
  const identity: JsonRecord = {};
  for (const key of ["name", "version"]) {
    const value = optionalText(field(scope, key), path + ".scope." + key);
    if (value !== undefined) identity[key] = value;
  }
  const result: JsonRecord = {
    scope: identity,
    scopeAttributes: attributes(
      field(scope, "attributes"),
      path + ".scope.attributes",
      { values: 0 },
    ),
  };
  const schemaUrl = optionalText(
    field(scopeLogs, "schemaUrl"),
    path + ".schemaUrl",
  );
  if (schemaUrl !== undefined) result.scopeSchemaUrl = schemaUrl;
  if (present(field(scope, "droppedAttributesCount"))) {
    result.scopeDroppedAttributesCount = uint32(
      field(scope, "droppedAttributesCount"),
      path + ".scope.droppedAttributesCount",
    );
  }
  byteLimit(result, path + ".scope");
  return result;
}

function normalizeSeverity(
  logRecord: JsonRecord,
  path: string,
): {
  level: LogEvent["level"];
  severityNumber?: number;
  severityText?: string;
} {
  const rawNumber = field(logRecord, "severityNumber");
  const severityText = optionalText(
    field(logRecord, "severityText"),
    path + ".severityText",
  );
  if (!present(rawNumber)) {
    return {
      level: "info",
      ...(severityText !== undefined ? { severityText } : {}),
    };
  }
  if (
    typeof rawNumber !== "number" ||
    !Number.isSafeInteger(rawNumber) ||
    rawNumber < 0 ||
    rawNumber > 24
  ) {
    fail(
      path + ".severityNumber",
      "must be an integer OTLP severity value from 0 through 24",
      "unsupported_severity_number",
    );
  }
  let level: LogEvent["level"];
  if (rawNumber <= 8) {
    level = rawNumber === 0 ? "info" : "debug";
  } else if (rawNumber <= 12) {
    level = "info";
  } else if (rawNumber <= 16) {
    level = "warn";
  } else {
    level = "error";
  }
  return {
    level,
    severityNumber: rawNumber,
    ...(severityText !== undefined ? { severityText } : {}),
  };
}

function parseTimestamp(
  logRecord: JsonRecord,
  path: string,
): {
  timestamp: string;
  selectedTimestampField: "timeUnixNano" | "observedTimeUnixNano";
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
} {
  const rawTime = field(logRecord, "timeUnixNano");
  const rawObservedTime = field(logRecord, "observedTimeUnixNano");
  let time: bigint | undefined;
  let observedTime: bigint | undefined;
  let parsedTime: bigint | undefined;
  let parsedObservedTime: bigint | undefined;
  if (present(rawTime)) {
    parsedTime = unsigned(rawTime, path + ".timeUnixNano");
    if (parsedTime !== 0n) time = parsedTime;
  }
  if (present(rawObservedTime)) {
    parsedObservedTime = unsigned(
      rawObservedTime,
      path + ".observedTimeUnixNano",
    );
    if (parsedObservedTime !== 0n) observedTime = parsedObservedTime;
  }
  const selected = time ?? observedTime;
  if (selected === undefined) {
    fail(
      path + ".timeUnixNano",
      "timeUnixNano or observedTimeUnixNano must contain a non-zero timestamp",
      "missing_timestamp",
    );
  }
  const date = new Date(Number(selected / NANOS_PER_MILLISECOND));
  if (Number.isNaN(date.getTime())) {
    fail(
      time !== undefined
        ? path + ".timeUnixNano"
        : path + ".observedTimeUnixNano",
      "is outside the supported timestamp range",
    );
  }
  return {
    timestamp: date.toISOString(),
    selectedTimestampField:
      time !== undefined ? "timeUnixNano" : "observedTimeUnixNano",
    ...(parsedTime !== undefined
      ? { timeUnixNano: parsedTime.toString() }
      : {}),
    ...(parsedObservedTime !== undefined
      ? { observedTimeUnixNano: parsedObservedTime.toString() }
      : {}),
  };
}

function normalizeOptionalId(
  value: unknown,
  path: string,
  expectedLength: number,
  warningCode: string,
  warnings: LocalWarning[],
): string | undefined {
  if (!present(value)) return undefined;
  if (
    typeof value !== "string" ||
    value.length !== expectedLength ||
    !/^[0-9a-fA-F]+$/.test(value) ||
    /^0+$/.test(value)
  ) {
    warnings.push({
      code: warningCode,
      path,
      message:
        "invalid optional " +
        expectedLength +
        "-character hexadecimal identifier was ignored",
    });
    return undefined;
  }
  return value.toLowerCase();
}

function normalizeBody(
  logRecord: JsonRecord,
  path: string,
): { message: string; bodyType: string; structuredBody?: unknown } {
  const rawBody = field(logRecord, "body");
  if (!present(rawBody)) return { message: "", bodyType: "absent" };
  const bodyRecord = record(rawBody, path + ".body");
  const fields = ANY_VALUE_FIELDS.filter((key) =>
    present(field(bodyRecord, key)),
  );
  const bodyType = fields[0] ?? "empty";
  const decoded = anyValue(rawBody, path + ".body", { values: 0 }, 0);
  if (bodyType === "stringValue") {
    return { message: decoded as string, bodyType };
  }
  if (bodyType === "empty") {
    return { message: "", bodyType, structuredBody: null };
  }
  return {
    message: stableJson(decoded),
    bodyType,
    structuredBody: decoded,
  };
}

function normalizeLogRecord(
  rawLogRecord: unknown,
  resource: JsonRecord,
  scope: JsonRecord,
  service: string,
  environment: string | undefined,
  path: string,
): { event: LogEvent; warnings: LocalWarning[] } {
  const logRecord = record(rawLogRecord, path);
  const timestamp = parseTimestamp(logRecord, path);
  const severity = normalizeSeverity(logRecord, path);
  const normalizedBody = normalizeBody(logRecord, path);
  const logAttributes = attributes(
    field(logRecord, "attributes"),
    path + ".attributes",
    { values: 0 },
  );
  const flags = uint32(field(logRecord, "flags"), path + ".flags");
  const droppedAttributesCount = uint32(
    field(logRecord, "droppedAttributesCount"),
    path + ".droppedAttributesCount",
  );
  const eventName = optionalText(
    field(logRecord, "eventName"),
    path + ".eventName",
  );
  const warnings: LocalWarning[] = [];
  const traceId = normalizeOptionalId(
    field(logRecord, "traceId"),
    path + ".traceId",
    TRACE_ID_LENGTH,
    "invalid_trace_id_ignored",
    warnings,
  );
  const candidateSpanId = normalizeOptionalId(
    field(logRecord, "spanId"),
    path + ".spanId",
    SPAN_ID_LENGTH,
    "invalid_span_id_ignored",
    warnings,
  );
  let spanId: string | undefined;
  if (candidateSpanId !== undefined && traceId !== undefined) {
    spanId = candidateSpanId;
  } else if (candidateSpanId !== undefined) {
    warnings.push({
      code: "orphan_span_id_ignored",
      path: path + ".spanId",
      message: "valid spanId without a valid traceId was ignored",
    });
  }
  const otel: JsonRecord = {
    ...resource,
    ...scope,
    logAttributes,
    selectedTimestampField: timestamp.selectedTimestampField,
    bodyType: normalizedBody.bodyType,
    flags,
    traceFlags: flags & 0xff,
    sampled: (flags & 1) === 1,
    droppedAttributesCount,
  };
  if (timestamp.timeUnixNano !== undefined) {
    otel.timeUnixNano = timestamp.timeUnixNano;
  }
  if (timestamp.observedTimeUnixNano !== undefined) {
    otel.observedTimeUnixNano = timestamp.observedTimeUnixNano;
  }
  if (severity.severityNumber !== undefined) {
    otel.severityNumber = severity.severityNumber;
  }
  if (severity.severityText !== undefined) {
    otel.severityText = severity.severityText;
  }
  if (eventName !== undefined) otel.eventName = eventName;
  if (normalizedBody.structuredBody !== undefined) {
    otel.body = normalizedBody.structuredBody;
  }
  const metadata = { otel };
  byteLimit(metadata, path);
  const stackTrace = logAttributes["exception.stacktrace"];
  const event: LogEvent = {
    timestamp: timestamp.timestamp,
    service,
    level: severity.level,
    message: normalizedBody.message,
    ...(typeof stackTrace === "string" ? { stackTrace } : {}),
    ...(traceId !== undefined ? { traceId } : {}),
    ...(spanId !== undefined ? { spanId } : {}),
    ...(environment !== undefined ? { environment } : {}),
    metadata: JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>,
  };
  return { event, warnings };
}

function serviceAndEnvironment(resource: JsonRecord): {
  service: string;
  environment?: string;
} {
  const resourceAttributes = resource.resourceAttributes as JsonRecord;
  const serviceValue = field(resourceAttributes, "service.name");
  const currentEnvironment = field(
    resourceAttributes,
    "deployment.environment.name",
  );
  const legacyEnvironment = field(
    resourceAttributes,
    "deployment.environment",
  );
  const environment =
    typeof currentEnvironment === "string" &&
    currentEnvironment.trim() !== ""
      ? currentEnvironment
      : typeof legacyEnvironment === "string" &&
          legacyEnvironment.trim() !== ""
        ? legacyEnvironment
        : undefined;
  return {
    service:
      typeof serviceValue === "string" && serviceValue.trim() !== ""
        ? serviceValue
        : UNKNOWN_SERVICE,
    ...(environment !== undefined ? { environment } : {}),
  };
}

/**
 * Pure OTLP log normalization. Top-level envelope errors throw. Nested
 * record errors retain healthy siblings. Invalid optional trace context is
 * reported as a warning and omitted, as required by the OTLP log contract.
 */
export function normalizeOtlpLogRequest(
  request: unknown,
): OtlpLogNormalizationResult {
  const root = record(request, "request");
  const resources = list(field(root, "resourceLogs"), "resourceLogs");
  const result: OtlpLogNormalizationResult = {
    events: [],
    rejectedLogRecords: 0,
    hasUncountableRejections: false,
    issues: [],
  };
  type Location = Omit<
    OtlpLogNormalizationIssue,
    "code" | "path" | "message" | "severity"
  >;
  function issue(
    error: unknown,
    location: Location,
    uncountable = false,
  ): void {
    if (!(error instanceof OtlpLogNormalizationError)) throw error;
    result.issues.push({
      code: error.code,
      path: error.path,
      message: error.reason,
      severity: "error",
      ...location,
    });
    if (uncountable) result.hasUncountableRejections = true;
  }
  function warning(value: LocalWarning, location: Location): void {
    result.issues.push({ ...value, severity: "warning", ...location });
  }
  resources.forEach((rawResource, resourceLogsIndex) => {
    const resourcePath = "resourceLogs[" + resourceLogsIndex + "]";
    const resourceLocation: Location = {
      scope: "resource",
      resourceLogsIndex,
    };
    let resourceLogs: JsonRecord;
    let scopes: unknown[];
    try {
      resourceLogs = record(rawResource, resourcePath);
      scopes = list(
        field(resourceLogs, "scopeLogs"),
        resourcePath + ".scopeLogs",
      );
    } catch (error) {
      issue(error, resourceLocation, true);
      return;
    }
    let resource: JsonRecord = {};
    let resourceFailed = false;
    try {
      resource = resourceContext(resourceLogs, resourcePath);
    } catch (error) {
      issue(error, resourceLocation);
      resourceFailed = true;
    }
    const identity = resourceFailed
      ? { service: UNKNOWN_SERVICE }
      : serviceAndEnvironment(resource);
    scopes.forEach((rawScope, scopeLogsIndex) => {
      const scopePath =
        resourcePath + ".scopeLogs[" + scopeLogsIndex + "]";
      const scopeLocation: Location = {
        scope: "scope",
        resourceLogsIndex,
        scopeLogsIndex,
      };
      let scopeLogs: JsonRecord;
      let logRecords: unknown[];
      try {
        scopeLogs = record(rawScope, scopePath);
        logRecords = list(
          field(scopeLogs, "logRecords"),
          scopePath + ".logRecords",
        );
      } catch (error) {
        issue(error, scopeLocation, true);
        return;
      }
      let scope: JsonRecord = {};
      let scopeFailed = false;
      try {
        scope = scopeContext(scopeLogs, scopePath);
      } catch (error) {
        issue(error, scopeLocation);
        scopeFailed = true;
      }
      if (resourceFailed || scopeFailed) {
        result.rejectedLogRecords += logRecords.length;
        return;
      }
      logRecords.forEach((rawLogRecord, logRecordIndex) => {
        const logPath =
          scopePath + ".logRecords[" + logRecordIndex + "]";
        const logLocation: Location = {
          scope: "log_record",
          resourceLogsIndex,
          scopeLogsIndex,
          logRecordIndex,
        };
        try {
          const normalized = normalizeLogRecord(
            rawLogRecord,
            resource,
            scope,
            identity.service,
            identity.environment,
            logPath,
          );
          result.events.push(normalized.event);
          normalized.warnings.forEach((value) =>
            warning(value, logLocation),
          );
        } catch (error) {
          issue(error, logLocation);
          result.rejectedLogRecords++;
        }
      });
    });
  });
  return result;
}
