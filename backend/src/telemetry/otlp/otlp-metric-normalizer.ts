import { Buffer } from "node:buffer";
import type { MetricEvent } from "../../types/metric-event.js";

type JsonRecord = Record<string, unknown>;
type IssueScope = "resource" | "scope" | "metric" | "data_point";

export const OTLP_METRIC_LIMITS = Object.freeze({
  metadataBytes: 65_536,
  attributeDepth: 16,
  attributeValues: 4_096,
  attributesPerContainer: 256,
  exemplarsPerPoint: 256,
  histogramBucketsPerPoint: 4_096,
});

const UINT64_MAX = (1n << 64n) - 1n;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const KINDS = ["gauge", "sum", "histogram", "exponentialHistogram", "summary"] as const;
const VALUES = ["stringValue", "boolValue", "intValue", "doubleValue",
  "arrayValue", "kvlistValue", "bytesValue"] as const;

export class OtlpMetricNormalizationError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
    readonly code = "invalid_field",
  ) {
    super(path + ": " + reason);
    this.name = "OtlpMetricNormalizationError";
  }
}

export interface OtlpMetricNormalizationIssue {
  code: string;
  path: string;
  message: string;
  scope: IssueScope;
  resourceMetricsIndex: number;
  scopeMetricsIndex?: number;
  metricIndex?: number;
  dataPointIndex?: number;
}

export interface OtlpMetricNormalizationResult {
  events: MetricEvent[];
  /** Counts known rejected points, once per point, not the number of issues. */
  rejectedDataPoints: number;
  /** A malformed container/type prevented an exact rejected-point count. */
  hasUncountableRejections: boolean;
  issues: OtlpMetricNormalizationIssue[];
}

function fail(path: string, reason: string, code = "invalid_field"): never {
  throw new OtlpMetricNormalizationError(path, reason, code);
}

function field(record: JsonRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
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

function integer(value: unknown, path: string, min: bigint, max: bigint): bigint {
  let parsed: bigint;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^-?\d+$/.test(value)) {
    // Avoid doing unbounded BigInt work on an invalid integer string.
    const digits = value.replace(/^-?0*/, "");
    if (digits.length > 20) fail(path, "is outside the supported integer range");
    parsed = BigInt((value.startsWith("-") ? "-" : "") + (digits || "0"));
  } else {
    fail(path, "must be a decimal integer string or safe integer number");
  }
  if (parsed < min || parsed > max) fail(path, "is outside the supported integer range");
  return parsed;
}

function unsigned(value: unknown, path: string): bigint {
  return integer(value, path, 0n, UINT64_MAX);
}

function finiteDouble(value: unknown, path: string): number {
  // ProtoJSON permits quoted numeric values. Special non-finite values cannot
  // be stored safely through the current numeric event/JSON publisher contract.
  if (typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    value = Number(value);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "must be a finite double", "non_finite_or_invalid_value");
  }
  return value;
}

function numberValue(point: JsonRecord, path: string): { value: number; valueType: string } {
  const keys = ["asInt", "asDouble"].filter(key => present(field(point, key)));
  if (keys.length !== 1) fail(path, "must contain exactly one of asInt or asDouble", "invalid_value_oneof");
  if (keys[0] === "asDouble") {
    return { value: finiteDouble(field(point, "asDouble"), path + ".asDouble"), valueType: "asDouble" };
  }
  const value = integer(field(point, "asInt"), path + ".asInt", INT64_MIN, INT64_MAX);
  if (value < SAFE_MIN || value > SAFE_MAX) {
    fail(path + ".asInt", "cannot be represented as a safe MetricEvent integer", "unsafe_integer");
  }
  return { value: Number(value), valueType: "asInt" };
}

interface Budget { values: number }

function consume(budget: Budget, depth: number, path: string): void {
  if (++budget.values > OTLP_METRIC_LIMITS.attributeValues ||
      depth > OTLP_METRIC_LIMITS.attributeDepth) {
    fail(path, "exceeds the attribute complexity limit", "metadata_limit_exceeded");
  }
}

function attributes(value: unknown, path: string, budget: Budget, depth = 0): JsonRecord {
  const entries = list(value, path);
  if (entries.length > OTLP_METRIC_LIMITS.attributesPerContainer) {
    fail(path, "exceeds the attribute count limit", "metadata_limit_exceeded");
  }
  const result: JsonRecord = {};
  entries.forEach((entry, index) => {
    const at = path + "[" + index + "]";
    const item = record(entry, at);
    const key = text(field(item, "key"), at + ".key");
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      fail(at + ".key", "duplicate attribute key", "duplicate_attribute");
    }
    if (!present(field(item, "value"))) fail(at + ".value", "is required");
    const decoded = anyValue(field(item, "value"), at + ".value", budget, depth);
    // Preserve arbitrary telemetry keys without invoking __proto__ setters.
    Object.defineProperty(result, key, {
      value: decoded, enumerable: true, configurable: true, writable: true,
    });
  });
  return result;
}

function anyValue(value: unknown, path: string, budget: Budget, depth: number): unknown {
  consume(budget, depth, path);
  const item = record(value, path);
  const keys = VALUES.filter(key => present(field(item, key)));
  if (keys.length === 0) return null; // Empty AnyValue; unknown fields are ignored.
  if (keys.length !== 1) fail(path, "must contain at most one AnyValue field");
  const key = keys[0]!;
  const raw = field(item, key);
  const at = path + "." + key;
  switch (key) {
    case "stringValue": {
      const result = text(raw, at);
      if (Buffer.byteLength(result) > OTLP_METRIC_LIMITS.metadataBytes) {
        fail(at, "exceeds the metadata byte limit", "metadata_limit_exceeded");
      }
      return result;
    }
    case "boolValue":
      if (typeof raw !== "boolean") fail(at, "must be a boolean");
      return raw;
    case "intValue": {
      const parsed = integer(raw, at, INT64_MIN, INT64_MAX);
      return parsed >= SAFE_MIN && parsed <= SAFE_MAX ? Number(parsed) : parsed.toString();
    }
    case "doubleValue":
      return raw === "NaN" || raw === "Infinity" || raw === "-Infinity"
        ? raw : finiteDouble(raw, at);
    case "bytesValue": {
      const encoded = text(raw, at);
      if (encoded.length > OTLP_METRIC_LIMITS.metadataBytes) {
        fail(at, "exceeds the metadata byte limit", "metadata_limit_exceeded");
      }
      const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const bare = normalized.replace(/=+$/, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || bare.length % 4 === 1 ||
          (normalized.includes("=") && normalized.length % 4 !== 0) ||
          Buffer.from(normalized, "base64").toString("base64").replace(/=+$/, "") !== bare) {
        fail(at, "must be a valid base64 string");
      }
      return encoded;
    }
    case "arrayValue": {
      const array = record(raw, at);
      const values = list(field(array, "values"), at + ".values");
      if (values.length > OTLP_METRIC_LIMITS.attributeValues) {
        fail(at, "exceeds the attribute complexity limit", "metadata_limit_exceeded");
      }
      return values.map((child, index) => anyValue(child, at + ".values[" + index + "]", budget, depth + 1));
    }
    case "kvlistValue": {
      const kv = record(raw, at);
      return attributes(field(kv, "values"), at + ".values", budget, depth + 1);
    }
  }
}

function byteLimit(value: unknown, path: string): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > OTLP_METRIC_LIMITS.metadataBytes) {
    fail(path, "exceeds the normalized metadata byte limit", "metadata_limit_exceeded");
  }
}

function uint32(value: unknown, path: string): number {
  return present(value) ? Number(integer(value, path, 0n, 4_294_967_295n)) : 0;
}

function resourceContext(rm: JsonRecord, path: string): JsonRecord {
  const resource = optionalRecord(field(rm, "resource"), path + ".resource");
  const result: JsonRecord = {
    resourceAttributes: attributes(field(resource, "attributes"), path + ".resource.attributes", { values: 0 }),
  };
  const schema = optionalText(field(rm, "schemaUrl"), path + ".schemaUrl");
  if (schema !== undefined) result.resourceSchemaUrl = schema;
  if (present(field(resource, "droppedAttributesCount"))) {
    result.resourceDroppedAttributesCount = uint32(field(resource, "droppedAttributesCount"), path + ".resource.droppedAttributesCount");
  }
  byteLimit(result, path + ".resource");
  return result;
}

function scopeContext(sm: JsonRecord, path: string): JsonRecord {
  const scope = optionalRecord(field(sm, "scope"), path + ".scope");
  const identity: JsonRecord = {};
  for (const key of ["name", "version"]) {
    const value = optionalText(field(scope, key), path + ".scope." + key);
    if (value !== undefined) identity[key] = value;
  }
  const result: JsonRecord = {
    scope: identity,
    scopeAttributes: attributes(field(scope, "attributes"), path + ".scope.attributes", { values: 0 }),
  };
  const schema = optionalText(field(sm, "schemaUrl"), path + ".schemaUrl");
  if (schema !== undefined) result.scopeSchemaUrl = schema;
  if (present(field(scope, "droppedAttributesCount"))) {
    result.scopeDroppedAttributesCount = uint32(field(scope, "droppedAttributesCount"), path + ".scope.droppedAttributesCount");
  }
  byteLimit(result, path + ".scope");
  return result;
}

function metricContext(metric: JsonRecord, path: string): { name: string; unit?: string; otel: JsonRecord } {
  const name = text(field(metric, "name"), path + ".name");
  if (name.trim().length === 0) fail(path + ".name", "must not be empty");
  const unit = optionalText(field(metric, "unit"), path + ".unit");
  const description = optionalText(field(metric, "description"), path + ".description");
  const otel: JsonRecord = {
    metricAttributes: attributes(field(metric, "metadata"), path + ".metadata", { values: 0 }),
  };
  if (description !== undefined) otel.metricDescription = description;
  byteLimit(otel, path);
  return { name, ...(unit !== undefined ? { unit } : {}), otel };
}

export function validateCumulativeMonotonicSum(data: JsonRecord, path: string): void {
  const temporalityPath = path + ".aggregationTemporality";
  const temporality = field(data, "aggregationTemporality");
  if (!present(temporality) || temporality === 0) {
    fail(temporalityPath, "must be cumulative (2); unspecified temporality is unsupported", "unsupported_sum_temporality");
  }
  if (typeof temporality !== "number" || !Number.isSafeInteger(temporality)) {
    fail(temporalityPath, "must be an integer OTLP enum value", "invalid_sum_temporality");
  }
  if (temporality !== 2) {
    fail(temporalityPath, "Phase 5D supports cumulative (2) Sum metrics only", "unsupported_sum_temporality");
  }

  const monotonicPath = path + ".isMonotonic";
  const monotonic = field(data, "isMonotonic");
  if (present(monotonic) && typeof monotonic !== "boolean") {
    fail(monotonicPath, "must be a boolean");
  }
  if (monotonic !== true) {
    fail(monotonicPath, "Phase 5D supports monotonic Sum metrics only", "unsupported_sum_monotonicity");
  }
}

function exemplar(value: unknown, path: string, budget: Budget): JsonRecord {
  consume(budget, 0, path);
  const item = record(value, path);
  const time = unsigned(field(item, "timeUnixNano"), path + ".timeUnixNano");
  if (time === 0n) fail(path + ".timeUnixNano", "must not be zero");
  const keys = ["asInt", "asDouble"].filter(key => present(field(item, key)));
  if (keys.length !== 1) fail(path, "must contain exactly one exemplar value");
  const result: JsonRecord = {
    timeUnixNano: time.toString(),
    filteredAttributes: attributes(field(item, "filteredAttributes"), path + ".filteredAttributes", budget),
  };
  if (keys[0] === "asInt") {
    const n = integer(field(item, "asInt"), path + ".asInt", INT64_MIN, INT64_MAX);
    result.asInt = n >= SAFE_MIN && n <= SAFE_MAX ? Number(n) : n.toString();
  } else {
    result.asDouble = finiteDouble(field(item, "asDouble"), path + ".asDouble");
  }
  for (const [key, length] of [["traceId", 32], ["spanId", 16]] as const) {
    const raw = field(item, key);
    if (!present(raw) || raw === "") continue;
    const id = text(raw, path + "." + key);
    if (id.length !== length || !/^[0-9a-fA-F]+$/.test(id) || /^0+$/.test(id)) {
      fail(path + "." + key, "must be a non-zero hexadecimal identifier of length " + length);
    }
    result[key] = id.toLowerCase();
  }
  return result;
}

/** Shared wire-level validators used by isolated metric-kind normalizers. */
export const otlpMetricNormalizationHelpers = Object.freeze({
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
});

export function normalizePoint(
  value: unknown, path: string, service: string,
  metric: ReturnType<typeof metricContext>, base: JsonRecord, kind: "gauge" | "sum",
): MetricEvent {
  const point = record(value, path);
  const flags = uint32(field(point, "flags"), path + ".flags");
  if (flags !== 0) {
    fail(path + ".flags", (flags & 1) !== 0
      ? "no-recorded-value markers cannot be represented by MetricEvent"
      : "unsupported data point flags", "unsupported_data_point_flags");
  }
  const nanos = unsigned(field(point, "timeUnixNano"), path + ".timeUnixNano");
  if (nanos === 0n) fail(path + ".timeUnixNano", "must not be zero");
  // uint64 nanoseconds end in 2554; the millisecond quotient is a safe JS
  // integer and fits DateTime64(3) on the verified ClickHouse 26.7 deployment.
  // Preserve exact nanoseconds in metadata; storage precision is milliseconds.
  const milliseconds = nanos / 1_000_000n;
  const numeric = numberValue(point, path);
  if (kind === "sum" && numeric.value < 0) {
    fail(path + "." + numeric.valueType, "must be non-negative for a monotonic Sum", "negative_monotonic_sum");
  }
  const budget: Budget = { values: 0 };
  const otel: JsonRecord = {
    ...base, ...metric.otel,
    ...(kind === "sum" ? {
      metricDataKind: "sum",
      aggregationTemporality: 2,
      isMonotonic: true,
    } : {}),
    dataPointAttributes: attributes(field(point, "attributes"), path + ".attributes", budget),
    timeUnixNano: nanos.toString(),
    valueType: numeric.valueType,
    flags,
  };
  const startValue = field(point, "startTimeUnixNano");
  if (kind === "sum") {
    if (!present(startValue)) {
      fail(path + ".startTimeUnixNano", "is required and must be non-zero for a cumulative Sum", "missing_sum_start_time");
    }
    const start = unsigned(startValue, path + ".startTimeUnixNano");
    if (start === 0n) {
      fail(path + ".startTimeUnixNano", "is required and must be non-zero for a cumulative Sum", "missing_sum_start_time");
    }
    if (start > nanos) {
      fail(path + ".startTimeUnixNano", "must not be after timeUnixNano", "invalid_sum_interval");
    }
    otel.startTimeUnixNano = start.toString();
  } else if (present(startValue)) {
    // Gauge start time is metadata only: do not impose Sum interval semantics.
    otel.startTimeUnixNano = unsigned(startValue, path + ".startTimeUnixNano").toString();
  }
  const exemplars = list(field(point, "exemplars"), path + ".exemplars");
  if (exemplars.length > OTLP_METRIC_LIMITS.exemplarsPerPoint) {
    fail(path + ".exemplars", "exceeds the exemplar count limit", "metadata_limit_exceeded");
  }
  if (present(field(point, "exemplars"))) {
    otel.exemplars = exemplars.map((entry, index) => exemplar(entry, path + ".exemplars[" + index + "]", budget));
  }
  const metadata = { otel };
  byteLimit(metadata, path);
  return {
    timestamp: new Date(Number(milliseconds)).toISOString(),
    service, name: metric.name, type: kind === "sum" ? "counter" : "gauge", value: numeric.value,
    ...(metric.unit !== undefined ? { unit: metric.unit } : {}),
    // Do not share mutable metadata between events or with the caller.
    metadata: JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>,
  };
}

/**
 * Pure OTLP Gauge and Phase 5D cumulative-monotonic Sum normalization.
 * Top-level envelope errors throw. Nested errors retain healthy siblings.
 * A future receiver must inspect issues AND hasUncountableRejections; zero
 * rejectedDataPoints alone does not imply complete acceptance.
 */
export function normalizeOtlpMetricRequest(request: unknown): OtlpMetricNormalizationResult {
  const root = record(request, "request");
  const resources = list(field(root, "resourceMetrics"), "resourceMetrics");
  const result: OtlpMetricNormalizationResult = {
    events: [], rejectedDataPoints: 0, hasUncountableRejections: false, issues: [],
  };
  type Location = Omit<OtlpMetricNormalizationIssue, "code" | "path" | "message">;
  function issue(error: unknown, location: Location, uncountable = false): void {
    if (!(error instanceof OtlpMetricNormalizationError)) throw error;
    result.issues.push({ code: error.code, path: error.path, message: error.reason, ...location });
    if (uncountable) result.hasUncountableRejections = true;
  }
  resources.forEach((rawResource, resourceMetricsIndex) => {
    const rp = "resourceMetrics[" + resourceMetricsIndex + "]";
    const rl: Location = { scope: "resource", resourceMetricsIndex };
    let rm: JsonRecord, scopes: unknown[];
    try {
      rm = record(rawResource, rp);
      scopes = list(field(rm, "scopeMetrics"), rp + ".scopeMetrics");
    } catch (error) { issue(error, rl, true); return; }
    let resource: JsonRecord = {}, resourceFailed = false;
    try { resource = resourceContext(rm, rp); }
    catch (error) { issue(error, rl); resourceFailed = true; }
    const serviceValue = field((resource.resourceAttributes ?? {}) as JsonRecord, "service.name");
    const service = typeof serviceValue === "string" && serviceValue.trim() !== "" ? serviceValue : "unknown_service";
    scopes.forEach((rawScope, scopeMetricsIndex) => {
      const sp = rp + ".scopeMetrics[" + scopeMetricsIndex + "]";
      const sl: Location = { scope: "scope", resourceMetricsIndex, scopeMetricsIndex };
      let sm: JsonRecord, metrics: unknown[];
      try {
        sm = record(rawScope, sp);
        metrics = list(field(sm, "metrics"), sp + ".metrics");
      } catch (error) { issue(error, sl, true); return; }
      let scope: JsonRecord = {}, scopeFailed = false;
      try { scope = scopeContext(sm, sp); }
      catch (error) { issue(error, sl); scopeFailed = true; }
      metrics.forEach((rawMetric, metricIndex) => {
        const mp = sp + ".metrics[" + metricIndex + "]";
        const ml: Location = { scope: "metric", resourceMetricsIndex, scopeMetricsIndex, metricIndex };
        let metric: JsonRecord, data: JsonRecord, kind: typeof KINDS[number], points: unknown[];
        try {
          metric = record(rawMetric, mp);
          const kinds = KINDS.filter(key => present(field(metric, key)));
          if (kinds.length !== 1) fail(mp, "must contain exactly one recognized metric data kind", "invalid_metric_oneof");
          kind = kinds[0]!;
          data = record(field(metric, kind), mp + "." + kind);
          points = list(field(data, "dataPoints"), mp + "." + kind + ".dataPoints");
        } catch (error) { issue(error, ml, true); return; }
        if (kind !== "gauge" && kind !== "sum") {
          issue(new OtlpMetricNormalizationError(mp + "." + kind, "Phase 5D supports Gauge and cumulative monotonic Sum metrics only", "unsupported_metric_type"), ml);
          result.rejectedDataPoints += points.length;
          return;
        }
        if (resourceFailed || scopeFailed) {
          result.rejectedDataPoints += points.length;
          return;
        }
        let context: ReturnType<typeof metricContext>;
        try {
          context = metricContext(metric, mp);
          if (kind === "sum") validateCumulativeMonotonicSum(data, mp + ".sum");
        }
        catch (error) { issue(error, ml); result.rejectedDataPoints += points.length; return; }
        points.forEach((point, dataPointIndex) => {
          const dp = mp + "." + kind + ".dataPoints[" + dataPointIndex + "]";
          try {
            result.events.push(normalizePoint(point, dp, service, context, { ...resource, ...scope }, kind));
          } catch (error) {
            issue(error, { ...ml, scope: "data_point", dataPointIndex });
            result.rejectedDataPoints++;
          }
        });
      });
    });
  });
  return result;
}
