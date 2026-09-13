import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeOtlpMetricRequest as normalize,
  OtlpMetricNormalizationError,
  OTLP_METRIC_LIMITS,
} from "../telemetry/otlp/otlp-metric-normalizer.js";
import type { MetricEvent } from "../types/metric-event.js";

type RecordValue = Record<string, unknown>;
const POINT_PATH = "resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints[0]";
const SUM_POINT_PATH = "resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0]";

function point(overrides: RecordValue = {}): RecordValue {
  return { timeUnixNano: "1250999999", asDouble: 4.5, ...overrides };
}
function metric(points: unknown[] = [point()], overrides: RecordValue = {}): RecordValue {
  return { name: "demo.active_requests", unit: "1", gauge: { dataPoints: points }, ...overrides };
}
function sumMetric(
  points: unknown[] = [point({ startTimeUnixNano: "1000000000" })],
  sumOverrides: RecordValue = {}, metricOverrides: RecordValue = {},
): RecordValue {
  return {
    name: "demo.requests", unit: "{request}",
    sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: points, ...sumOverrides },
    ...metricOverrides,
  };
}
function request(metrics: unknown[] = [metric()]) {
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "checkout" } }] },
      scopeMetrics: [{
        scope: { name: "demo-meter", version: "1.0" },
        metrics,
      }],
    }],
  };
}
function one(input: unknown): MetricEvent {
  const result = normalize(input);
  assert.equal(result.rejectedDataPoints, 0);
  assert.equal(result.hasUncountableRejections, false);
  assert.deepEqual(result.issues, []);
  assert.equal(result.events.length, 1);
  return result.events[0]!;
}
function otel(event: MetricEvent): RecordValue {
  return event.metadata!.otel as RecordValue;
}
function rejectedPoint(overrides: RecordValue, suffix: string, code?: string): void {
  const result = normalize(request([metric([point(overrides), point()])]));
  assert.equal(result.events.length, 1, "healthy sibling is retained");
  assert.equal(result.rejectedDataPoints, 1);
  assert.equal(result.hasUncountableRejections, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.path, POINT_PATH + suffix);
  assert.equal(result.issues[0]!.scope, "data_point");
  assert.equal(result.issues[0]!.dataPointIndex, 0);
  if (code !== undefined) assert.equal(result.issues[0]!.code, code);
}

test("maps a gauge, truncates storage timestamp to ms, preserves exact nanoseconds", () => {
  const event = one(request());
  assert.equal(event.timestamp, "1970-01-01T00:00:01.250Z");
  assert.equal(event.service, "checkout");
  assert.equal(event.name, "demo.active_requests");
  assert.equal(event.type, "gauge");
  assert.equal(event.value, 4.5);
  assert.equal(event.unit, "1");
  assert.equal(otel(event).timeUnixNano, "1250999999");
  assert.equal(otel(event).valueType, "asDouble");
  assert.equal(otel(event).flags, 0);
  assert.deepEqual(otel(event).scope, { name: "demo-meter", version: "1.0" });
});

test("maps a cumulative monotonic Sum to a raw counter with exact OTLP semantics", () => {
  const event = one(request([sumMetric()]));
  assert.equal(event.timestamp, "1970-01-01T00:00:01.250Z");
  assert.equal(event.service, "checkout");
  assert.equal(event.name, "demo.requests");
  assert.equal(event.type, "counter");
  assert.equal(event.value, 4.5);
  assert.equal(event.unit, "{request}");
  assert.equal(otel(event).metricDataKind, "sum");
  assert.equal(otel(event).aggregationTemporality, 2);
  assert.equal(otel(event).isMonotonic, true);
  assert.equal(otel(event).startTimeUnixNano, "1000000000");
  assert.equal(otel(event).timeUnixNano, "1250999999");
  assert.equal(otel(event).valueType, "asDouble");
});

test("accepts zero values and exact zero-duration cumulative counter intervals", () => {
  const event = one(request([sumMetric([point({
    startTimeUnixNano: "1250999999", asDouble: undefined, asInt: "0",
  })])]));
  assert.equal(event.value, 0);
  assert.equal(event.type, "counter");
  assert.equal(otel(event).startTimeUnixNano, otel(event).timeUnixNano);
  assert.equal(otel(event).valueType, "asInt");
});

test("rejects unspecified, delta, unknown and non-numeric Sum temporalities", () => {
  for (const temporality of [undefined, null, 0, 1, 3, "2", 1.5]) {
    const result = normalize(request([sumMetric(undefined, { aggregationTemporality: temporality })]));
    assert.equal(result.events.length, 0);
    assert.equal(result.rejectedDataPoints, 1);
    assert.equal(result.hasUncountableRejections, false);
    assert.equal(result.issues[0]!.path,
      "resourceMetrics[0].scopeMetrics[0].metrics[0].sum.aggregationTemporality");
    assert.equal(result.issues[0]!.scope, "metric");
    assert.equal(result.issues[0]!.code,
      typeof temporality === "number" && !Number.isSafeInteger(temporality) || typeof temporality === "string"
        ? "invalid_sum_temporality" : "unsupported_sum_temporality");
  }
});

test("requires exact true monotonicity for supported Sum metrics", () => {
  for (const monotonic of [undefined, null, false, "true", 1]) {
    const result = normalize(request([sumMetric(undefined, { isMonotonic: monotonic })]));
    assert.equal(result.events.length, 0);
    assert.equal(result.rejectedDataPoints, 1);
    assert.equal(result.issues[0]!.path,
      "resourceMetrics[0].scopeMetrics[0].metrics[0].sum.isMonotonic");
    assert.equal(result.issues[0]!.scope, "metric");
    assert.equal(result.issues[0]!.code,
      typeof monotonic === "string" || typeof monotonic === "number"
        ? "invalid_field" : "unsupported_sum_monotonicity");
  }
});

test("requires valid cumulative intervals and retains healthy Sum siblings", () => {
  const result = normalize(request([sumMetric([
    point({ startTimeUnixNano: undefined, asDouble: 1 }),
    point({ startTimeUnixNano: "0", asDouble: 2 }),
    point({ startTimeUnixNano: "1251000000", asDouble: 3 }),
    point({ startTimeUnixNano: "1000000000", asDouble: 4 }),
  ])]));
  assert.deepEqual(result.events.map(event => event.value), [4]);
  assert.equal(result.rejectedDataPoints, 3);
  assert.equal(result.hasUncountableRejections, false);
  assert.deepEqual(result.issues.map(issue => issue.code),
    ["missing_sum_start_time", "missing_sum_start_time", "invalid_sum_interval"]);
  assert.deepEqual(result.issues.map(issue => issue.dataPointIndex), [0, 1, 2]);
  assert.equal(result.issues[0]!.path, SUM_POINT_PATH + ".startTimeUnixNano");
});

test("rejects negative monotonic Sum values without rounding", () => {
  const result = normalize(request([sumMetric([
    point({ startTimeUnixNano: "1", asDouble: undefined, asInt: "-1" }),
    point({ startTimeUnixNano: "1", asDouble: -0.25 }),
    point({ startTimeUnixNano: "1", asDouble: 0 }),
  ])]));
  assert.deepEqual(result.events.map(event => event.value), [0]);
  assert.equal(result.rejectedDataPoints, 2);
  assert.deepEqual(result.issues.map(issue => issue.code),
    ["negative_monotonic_sum", "negative_monotonic_sum"]);
  assert.equal(result.issues[0]!.path, SUM_POINT_PATH + ".asInt");
  assert.equal(result.issues[1]!.path,
    "resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[1].asDouble");
});

test("preserves provenance, metric metadata, schema URLs, units and description", () => {
  const attr = (value: string) => [{ key: "region", value: { stringValue: value } }];
  const input = {
    resourceMetrics: [{
      schemaUrl: "resource-schema",
      resource: { attributes: [...attr("resource"), { key: "service.name", value: { stringValue: "real-service" } }], droppedAttributesCount: 2 },
      scopeMetrics: [{
        schemaUrl: "scope-schema",
        scope: { name: "meter", version: "2", attributes: attr("scope"), droppedAttributesCount: 1 },
        metrics: [metric([point({ attributes: [...attr("point"), { key: "service.name", value: { stringValue: "not-the-resource" } }] })], {
          description: "Current sampled value", unit: "By", metadata: attr("metric"),
        })],
      }],
    }],
  };
  const event = one(input), data = otel(event);
  assert.equal(event.service, "real-service");
  assert.equal(event.unit, "By");
  assert.equal((data.resourceAttributes as RecordValue).region, "resource");
  assert.equal((data.scopeAttributes as RecordValue).region, "scope");
  assert.equal((data.dataPointAttributes as RecordValue).region, "point");
  assert.equal((data.metricAttributes as RecordValue).region, "metric");
  assert.equal(data.resourceSchemaUrl, "resource-schema");
  assert.equal(data.scopeSchemaUrl, "scope-schema");
  assert.equal(data.metricDescription, "Current sampled value");
  assert.equal(data.resourceDroppedAttributesCount, 2);
  assert.equal(data.scopeDroppedAttributesCount, 1);
});

test("missing, blank and non-string resource service names use the existing fallback", () => {
  for (const attributes of [
    [], [{ key: "service.name", value: { stringValue: " " } }],
    [{ key: "service.name", value: { intValue: "7" } }],
  ]) {
    const input = request();
    const event = one({ resourceMetrics: [{ ...input.resourceMetrics[0], resource: { attributes } }] });
    assert.equal(event.service, "unknown_service");
  }
  assert.equal(one({ resourceMetrics: [{ scopeMetrics: [{ metrics: [metric()] }] }] }).service, "unknown_service");
});

test("omits absent unit and retains empty unit without inventing conversion", () => {
  assert.equal("unit" in one(request([metric([point()], { unit: undefined })])), false);
  assert.equal(one(request([metric([point()], { unit: "" })])).unit, "");
});

test("accepts zero, negative/fractional doubles and quoted finite doubles", () => {
  for (const [input, expected] of [[0, 0], [-3.75, -3.75], ["1.25e2", 125], [1e100, 1e100]] as const) {
    assert.equal(one(request([metric([point({ asDouble: input })])])).value, expected);
  }
});

test("accepts safe int64 values with explicit value provenance", () => {
  for (const input of [0, -2, Number.MAX_SAFE_INTEGER, "0", "-9007199254740991", "9007199254740991"]) {
    const event = one(request([metric([point({ asDouble: undefined, asInt: input })])]));
    assert.equal(event.value, Number(input));
    assert.equal(otel(event).valueType, "asInt");
  }
});

test("rejects unsafe integer numbers and large int64 gauge values without rounding", () => {
  for (const input of [Number.MAX_SAFE_INTEGER + 1, "9007199254740992", "-9007199254740992", "9223372036854775807"]) {
    rejectedPoint({ asDouble: undefined, asInt: input }, ".asInt");
  }
});

test("rejects int64 overflow, fractional values, booleans and invalid integer strings", () => {
  for (const input of ["9223372036854775808", "-9223372036854775809", 1.5, true, "1.2", "x", ""]) {
    rejectedPoint({ asDouble: undefined, asInt: input }, ".asInt");
  }
});

test("rejects non-finite and invalid gauge doubles", () => {
  for (const input of [NaN, Infinity, -Infinity, "NaN", "Infinity", "-Infinity", "1e9999", "", "bad", true]) {
    rejectedPoint({ asDouble: input }, ".asDouble", "non_finite_or_invalid_value");
  }
});

test("value oneof requires exactly one non-null known value", () => {
  rejectedPoint({ asDouble: undefined }, "", "invalid_value_oneof");
  rejectedPoint({ asDouble: null }, "", "invalid_value_oneof");
  rejectedPoint({ asInt: "2" }, "", "invalid_value_oneof");
  assert.equal(one(request([metric([point({ asDouble: null, asInt: "0" })])])).value, 0);
});

test("timestamp requires a nonzero uint64; unsafe numbers are rejected", () => {
  for (const input of [undefined, null, "0", 0, "-1", -1, 1.5, "1.5", "18446744073709551616", Number("1720000000123456789")]) {
    rejectedPoint({ timeUnixNano: input }, ".timeUnixNano");
  }
});

test("accepts the uint64 timestamp boundary without an obsolete 2299 cutoff", () => {
  assert.equal(one(request([metric([point({ timeUnixNano: "18446744073709551615" })])])).timestamp,
    "2554-07-21T23:34:33.709Z");
  assert.equal(one(request([metric([point({ timeUnixNano: "10413792000000000000" })])])).timestamp,
    "2300-01-01T00:00:00.000Z");
  rejectedPoint({ timeUnixNano: "18446744073709551616" }, ".timeUnixNano");
});

test("sub-ms timestamps and safe numeric nanoseconds are accepted without rounding", () => {
  assert.equal(one(request([metric([point({ timeUnixNano: "1" })])])).timestamp, "1970-01-01T00:00:00.000Z");
  assert.equal(one(request([metric([point({ timeUnixNano: 1_999_999 })])])).timestamp, "1970-01-01T00:00:00.001Z");
  one(request([metric([point({ timeUnixNano: Number.MAX_SAFE_INTEGER })])]));
});

test("gauge start time is bounded uint64 metadata, not a Sum interval", () => {
  for (const start of ["0", "9999999999", "18446744073709551615"]) {
    assert.equal(otel(one(request([metric([point({ startTimeUnixNano: start })])]))).startTimeUnixNano, start);
  }
  rejectedPoint({ startTimeUnixNano: -1 }, ".startTimeUnixNano");
  rejectedPoint({ startTimeUnixNano: Number.MAX_SAFE_INTEGER + 1 }, ".startTimeUnixNano");
});

test("no-recorded-value and unknown flags never turn into zero-valued events", () => {
  rejectedPoint({ flags: 1, asDouble: undefined }, ".flags", "unsupported_data_point_flags");
  for (const flags of [2, 3, 0x80000000, 0xffffffff]) {
    rejectedPoint({ flags }, ".flags", "unsupported_data_point_flags");
  }
  for (const flags of [-1, 1.5, 0x100000000]) rejectedPoint({ flags }, ".flags");
  assert.equal(one(request([metric([point({ flags: "0", asDouble: 0 })])])).value, 0);
});

test("unknown fields are ignored; null optional/repeated fields mean unset", () => {
  const event = one({ resourceMetrics: [{ resource: null, scopeMetrics: [{
    scope: null, futureScopeField: true, metrics: [metric([point({
      attributes: null, flags: null, exemplars: null, futurePointField: { anything: true },
    })], { unit: null, metadata: null, futureMetricField: 5 })],
  }] }], futureRequestField: true });
  assert.equal(event.service, "unknown_service");
  assert.equal("unit" in event, false);
  assert.deepEqual(otel(event).dataPointAttributes, {});
});

test("empty OTLP request and empty nested batches have no rejections", () => {
  for (const input of [{}, { resourceMetrics: null }, { resourceMetrics: [] },
    { resourceMetrics: [{ scopeMetrics: null }] },
    request([]), request([metric([])]), request([metric([], { gauge: {} })])]) {
    assert.deepEqual(normalize(input), { events: [], rejectedDataPoints: 0, hasUncountableRejections: false, issues: [] });
  }
});

test("only invalid top-level envelopes throw; they do not look like empty success", () => {
  for (const input of [null, undefined, [], false, 42, "{}", { resourceMetrics: {} }]) {
    assert.throws(() => normalize(input), OtlpMetricNormalizationError);
  }
});

test("mixed-validity points preserve order and exact rejection paths", () => {
  const result = normalize(request([metric([point({ asDouble: 1 }), null, point({ asDouble: 3 }), point({ asDouble: "bad" })])]));
  assert.deepEqual(result.events.map(e => e.value), [1, 3]);
  assert.equal(result.rejectedDataPoints, 2);
  assert.deepEqual(result.issues.map(i => i.dataPointIndex), [1, 3]);
  assert.equal(result.hasUncountableRejections, false);
});

test("unsupported histogram families and summaries reject their points", () => {
  for (const kind of ["histogram", "exponentialHistogram", "summary"]) {
    const unsupported = { name: kind, [kind]: { dataPoints: [{}, {}, {}] } };
    const result = normalize(request([unsupported, metric()]));
    assert.equal(result.events.length, 1);
    assert.equal(result.rejectedDataPoints, 3);
    assert.equal(result.hasUncountableRejections, false);
    assert.equal(result.issues[0]!.code, "unsupported_metric_type");
    assert.equal(result.issues[0]!.path, "resourceMetrics[0].scopeMetrics[0].metrics[0]." + kind);
  }
});

test("unsupported empty metrics are reported without inventing rejected points", () => {
  const result = normalize(request([sumMetric([], { isMonotonic: false })]));
  assert.equal(result.rejectedDataPoints, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.hasUncountableRejections, false);
  assert.equal(result.issues[0]!.code, "unsupported_sum_monotonicity");
  assert.equal(result.issues[0]!.path, "resourceMetrics[0].scopeMetrics[0].metrics[0].sum.isMonotonic");
});

test("malformed or ambiguous metric containers explicitly mark unknown point counts", () => {
  for (const bad of [null, { name: "missing" }, metric([], { sum: { dataPoints: [] } }),
    metric([], { gauge: { dataPoints: "bad" } }), { name: "future", futureKind: { dataPoints: [{}] } }]) {
    const result = normalize(request([bad, metric()]));
    assert.equal(result.events.length, 1);
    assert.equal(result.rejectedDataPoints, 0);
    assert.equal(result.hasUncountableRejections, true);
    assert.equal(result.issues[0]!.metricIndex, 0);
  }
});

test("malformed resource/scope containers retain healthy siblings", () => {
  const healthy = request().resourceMetrics[0]!;
  const result = normalize({ resourceMetrics: [null, { scopeMetrics: "bad" }, {
    scopeMetrics: [null, { metrics: "bad" }, ...healthy.scopeMetrics],
  }, healthy] });
  assert.equal(result.events.length, 2);
  assert.equal(result.hasUncountableRejections, true);
  assert.equal(result.rejectedDataPoints, 0);
  assert.equal(result.issues.length, 4);
});

test("invalid resource attributes reject only descendant points, with accurate counts", () => {
  const healthy = request().resourceMetrics[0]!;
  const result = normalize({ resourceMetrics: [{
    ...healthy, resource: { attributes: "bad" },
    scopeMetrics: [{ metrics: [metric([point(), point(), point()])] }],
  }, healthy] });
  assert.equal(result.events.length, 1);
  assert.equal(result.rejectedDataPoints, 3);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.scope, "resource");
  assert.equal(result.hasUncountableRejections, false);
});

test("invalid scope metadata rejects its known points but retains other scopes", () => {
  const result = normalize({ resourceMetrics: [{ scopeMetrics: [
    { scope: { name: false }, metrics: [metric([point(), point()])] },
    { scope: { name: "valid" }, metrics: [metric()] },
  ] }] });
  assert.equal(result.events.length, 1);
  assert.equal(result.rejectedDataPoints, 2);
  assert.equal(result.issues[0]!.path, "resourceMetrics[0].scopeMetrics[0].scope.name");
});

test("invalid metric headers reject all their known points, not the whole batch", () => {
  for (const overrides of [{ name: "" }, { name: " " }, { name: 4 }, { unit: false }, { description: 3 }, { metadata: "bad" }]) {
    const result = normalize(request([metric([point(), point()], overrides), metric()]));
    assert.equal(result.events.length, 1);
    assert.equal(result.rejectedDataPoints, 2);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0]!.scope, "metric");
  }
});

test("decodes supported AnyValue forms without losing false, zero, bytes or large metadata integers", () => {
  const values = [
    { key: "false", value: { boolValue: false } }, { key: "zero", value: { intValue: "0" } },
    { key: "large", value: { intValue: "9223372036854775807" } },
    { key: "empty", value: {} }, { key: "bytes", value: { bytesValue: "AQID" } },
    { key: "bytes.url", value: { bytesValue: "_w" } },
    { key: "infinite.metadata", value: { doubleValue: "Infinity" } },
    { key: "array", value: { arrayValue: { values: [{ stringValue: "a" }, { intValue: "2" }] } } },
    { key: "nested", value: { kvlistValue: { values: [{ key: "child", value: { boolValue: true } }] } } },
  ];
  const attrs = otel(one(request([metric([point({ attributes: values })])]))).dataPointAttributes;
  assert.deepEqual(attrs, {
    false: false, zero: 0, large: "9223372036854775807", empty: null, bytes: "AQID",
    "bytes.url": "_w", "infinite.metadata": "Infinity", array: ["a", 2], nested: { child: true },
  });
});

test("malformed attribute values, duplicate keys and unsafe metadata integers reject the affected point", () => {
  const badValues = [null, { intValue: Number.MAX_SAFE_INTEGER + 1 }, { intValue: "9223372036854775808" },
    { boolValue: 1 }, { stringValue: 2 }, { bytesValue: "!!!" }, { bytesValue: "AB" },
    { intValue: "1", boolValue: true }];
  for (const value of badValues) {
    const r = normalize(request([metric([point({ attributes: [{ key: "bad", value }] }), point()])]));
    assert.equal(r.events.length, 1);
    assert.equal(r.rejectedDataPoints, 1);
  }
  const r = normalize(request([metric([point({ attributes: [
    { key: "duplicate", value: { intValue: "1" } }, { key: "duplicate", value: { intValue: "2" } },
  ] })])]));
  assert.equal(r.issues[0]!.code, "duplicate_attribute");
});

test("attribute keys cannot pollute object prototypes", () => {
  const attributes = [
    { key: "__proto__", value: { kvlistValue: { values: [{ key: "polluted", value: { boolValue: true } }] } } },
    { key: "constructor", value: { stringValue: "telemetry" } },
  ];
  const attrs = otel(one(request([metric([point({ attributes })])]))).dataPointAttributes as RecordValue;
  assert.equal(Object.prototype.hasOwnProperty.call(attrs, "__proto__"), true);
  assert.deepEqual(attrs.__proto__, { polluted: true });
  assert.equal(attrs.constructor, "telemetry");
  assert.equal((Object.prototype as RecordValue).polluted, undefined);
  assert.equal(Object.getPrototypeOf(attrs), Object.prototype);
});

test("bounded metadata rejects excessive attribute count, depth, values and UTF-8 bytes", () => {
  const tooMany = Array.from({ length: OTLP_METRIC_LIMITS.attributesPerContainer + 1 },
    (_, i) => ({ key: "k" + i, value: { intValue: "1" } }));
  let deep: unknown = { intValue: "1" };
  for (let i = 0; i < OTLP_METRIC_LIMITS.attributeDepth + 2; i++) deep = { arrayValue: { values: [deep] } };
  const cases = [
    tooMany, [{ key: "deep", value: deep }],
    [{ key: "many", value: { arrayValue: { values: Array.from({ length: OTLP_METRIC_LIMITS.attributeValues + 1 }, () => ({})) } } }],
    [{ key: "big", value: { stringValue: "é".repeat(OTLP_METRIC_LIMITS.metadataBytes / 2) } }],
  ];
  for (const attributes of cases) {
    const r = normalize(request([metric([point({ attributes }), point()])]));
    assert.equal(r.events.length, 1);
    assert.equal(r.rejectedDataPoints, 1);
    assert.equal(r.issues[0]!.code, "metadata_limit_exceeded");
  }
});

test("cyclic AnyValue input produces a bounded validation issue, not stack exhaustion", () => {
  const cycle = { arrayValue: { values: [] as unknown[] } };
  cycle.arrayValue.values.push(cycle);
  const r = normalize(request([metric([point({ attributes: [{ key: "cycle", value: cycle }] })])]));
  assert.equal(r.issues[0]!.code, "metadata_limit_exceeded");
});

test("preserves exemplars as metadata only, with exact large integers and normalized IDs", () => {
  const exemplar = {
    timeUnixNano: "1250123456", asInt: "9223372036854775807",
    traceId: "A".repeat(32), spanId: "B".repeat(16),
    filteredAttributes: [{ key: "sample", value: { boolValue: true } }],
  };
  const event = one(request([metric([point({ exemplars: [exemplar] })])]));
  assert.equal(event.value, 4.5);
  assert.deepEqual(otel(event).exemplars, [{
    ...exemplar, filteredAttributes: { sample: true }, traceId: "a".repeat(32), spanId: "b".repeat(16),
  }]);
});

test("malformed exemplars reject the affected point, and empty exemplars are preserved", () => {
  assert.deepEqual(otel(one(request([metric([point({ exemplars: [] })])]))).exemplars, []);
  for (const exemplar of [{ timeUnixNano: "1", asDouble: 2, traceId: "bad" },
    { timeUnixNano: "0", asDouble: 2 }, { timeUnixNano: "1", asInt: "2", asDouble: 2 },
    { timeUnixNano: "1", asDouble: NaN }]) {
    const r = normalize(request([metric([point({ exemplars: [exemplar] }), point()])]));
    assert.equal(r.rejectedDataPoints, 1);
    assert.equal(r.events.length, 1);
  }
  rejectedPoint({ exemplars: Array.from({ length: OTLP_METRIC_LIMITS.exemplarsPerPoint + 1 }, () => ({})) },
    ".exemplars", "metadata_limit_exceeded");
});

test("normalization does not mutate input or share output metadata between events", () => {
  const input = request([metric([point(), point()])]);
  const snapshot = structuredClone(input);
  const events = normalize(input).events;
  (otel(events[0]!).resourceAttributes as RecordValue)["service.name"] = "changed";
  assert.equal((otel(events[1]!).resourceAttributes as RecordValue)["service.name"], "checkout");
  assert.deepEqual(input, snapshot);
});

test("handles multiple resources/scopes/metrics in input order without aggregation", () => {
  const a = request([metric([point({ asDouble: 1 }), point({ asDouble: 2 })])]).resourceMetrics[0]!;
  const b = request([metric([point({ asDouble: 3 })]), metric([point({ asDouble: 4 })])]).resourceMetrics[0]!;
  const r = normalize({ resourceMetrics: [a, b] });
  assert.deepEqual(r.events.map(e => e.value), [1, 2, 3, 4]);
  assert.equal(r.rejectedDataPoints, 0);
});

test("normalizes a 100-point gauge batch with no publisher or external services", () => {
  const r = normalize(request([metric(Array.from({ length: 100 }, (_, asDouble) => point({ asDouble })))]));
  assert.equal(r.events.length, 100);
  assert.equal(r.rejectedDataPoints, 0);
  assert.deepEqual(r.issues, []);
});

test("normalizes long leading-zero integers before BigInt conversion", () => {
  const zeros = "0".repeat(100_000);
  for (const [input, expected] of [[zeros, 0], [zeros + "1", 1], ["-" + zeros + "2", -2]] as const) {
    assert.equal(one(request([metric([point({ asDouble: undefined, asInt: input })])])).value, expected);
  }
  const event = one(request([metric([point({
    timeUnixNano: zeros + "1",
    attributes: [{ key: "large", value: { intValue: "-" + zeros + "9223372036854775808" } }],
  })])]));
  assert.equal(otel(event).timeUnixNano, "1");
  assert.equal((otel(event).dataPointAttributes as RecordValue).large, "-9223372036854775808");
  rejectedPoint({ asDouble: undefined, asInt: "9".repeat(100_000) }, ".asInt");
});

test("enforces the exact final metadata byte limit and combined context size", () => {
  const withPayload = (payload: string) => request([metric([point({
    attributes: [{ key: "payload", value: { stringValue: payload } }],
  })])]);
  const overhead = Buffer.byteLength(JSON.stringify(one(withPayload("")).metadata), "utf8");
  const payload = "x".repeat(OTLP_METRIC_LIMITS.metadataBytes - overhead);
  const event = one(withPayload(payload));
  assert.equal(Buffer.byteLength(JSON.stringify(event.metadata), "utf8"), OTLP_METRIC_LIMITS.metadataBytes);
  const overflow = normalize(withPayload(payload + "x"));
  assert.equal(overflow.rejectedDataPoints, 1);
  assert.equal(overflow.issues[0]!.code, "metadata_limit_exceeded");

  const attr = [{ key: "payload", value: { stringValue: "x".repeat(40_000) } }];
  const healthy = request().resourceMetrics[0]!;
  const combined = normalize({ resourceMetrics: [{
    resource: { attributes: attr },
    scopeMetrics: [{ scope: { attributes: attr }, metrics: [metric()] }],
  }, healthy] });
  assert.equal(combined.events.length, 1);
  assert.equal(combined.rejectedDataPoints, 1);
  assert.equal(combined.issues[0]!.scope, "data_point");
  assert.equal(combined.issues[0]!.code, "metadata_limit_exceeded");
});

test("overlapping parent failures count known points only once and retain uncertainty", () => {
  const healthy = request().resourceMetrics[0]!;
  const result = normalize({ resourceMetrics: [{
    resource: { attributes: "bad" },
    scopeMetrics: [{
      scope: { name: false },
      metrics: [metric([point(), point()]), { name: "deferred", histogram: { dataPoints: [{}, {}, {}] } }],
    }, null],
  }, healthy] });
  assert.equal(result.events.length, 1);
  assert.equal(result.rejectedDataPoints, 5);
  assert.equal(result.hasUncountableRejections, true);
  assert.equal(result.issues.length, 4);
  assert.deepEqual(result.issues.map(issue => issue.scope), ["resource", "scope", "metric", "scope"]);
});

test("does not interpret inherited fields as OTLP envelope or point fields", () => {
  assert.deepEqual(normalize(Object.create(request())), {
    events: [], rejectedDataPoints: 0, hasUncountableRejections: false, issues: [],
  });
  const result = normalize(request([metric([Object.create(point()), point()])]));
  assert.equal(result.events.length, 1);
  assert.equal(result.rejectedDataPoints, 1);
  assert.equal(result.issues[0]!.path, POINT_PATH + ".timeUnixNano");
});
