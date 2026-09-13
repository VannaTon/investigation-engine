import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeOtlpLogRequest as normalize,
  OtlpLogNormalizationError,
  OTLP_LOG_LIMITS,
} from "../telemetry/otlp/otlp-log-normalizer.js";
import type { LogEvent } from "../types/log-event.js";

type RecordValue = Record<string, unknown>;
const LOG_PATH = "resourceLogs[0].scopeLogs[0].logRecords[0]";
const TRACE_ID = "5B8EFFF798038103D269B633813FC60C";
const SPAN_ID = "EEE19B7EC3C1B174";

function attribute(key: string, value: unknown): RecordValue {
  return { key, value };
}

function stringAttribute(key: string, value: string): RecordValue {
  return attribute(key, { stringValue: value });
}

function logRecord(overrides: RecordValue = {}): RecordValue {
  return {
    timeUnixNano: "1250999999",
    observedTimeUnixNano: "2250999999",
    severityNumber: 17,
    severityText: "ERROR",
    body: { stringValue: "checkout failed" },
    attributes: [],
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    ...overrides,
  };
}

function request(
  records: unknown[] = [logRecord()],
  resourceOverrides: RecordValue = {},
  scopeOverrides: RecordValue = {},
): RecordValue {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", "checkout"),
            stringAttribute("deployment.environment.name", "staging"),
          ],
        },
        scopeLogs: [
          {
            scope: { name: "demo-logger", version: "1.0" },
            logRecords: records,
            ...scopeOverrides,
          },
        ],
        ...resourceOverrides,
      },
    ],
  };
}

function one(input: unknown): LogEvent {
  const result = normalize(input);
  assert.equal(result.events.length, 1);
  assert.equal(result.rejectedLogRecords, 0);
  assert.equal(result.hasUncountableRejections, false);
  assert.deepEqual(result.issues, []);
  return result.events[0]!;
}

function otel(event: LogEvent): RecordValue {
  return event.metadata!.otel as RecordValue;
}

function rejectedRecord(
  overrides: RecordValue,
  expectedPath: string,
  expectedCode = "invalid_field",
): void {
  const result = normalize(
    request([logRecord(overrides), logRecord({ body: { stringValue: "ok" } })]),
  );
  assert.equal(result.events.length, 1, "healthy sibling is retained");
  assert.equal(result.events[0]!.message, "ok");
  assert.equal(result.rejectedLogRecords, 1);
  assert.equal(result.hasUncountableRejections, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.severity, "error");
  assert.equal(result.issues[0]!.scope, "log_record");
  assert.equal(result.issues[0]!.resourceLogsIndex, 0);
  assert.equal(result.issues[0]!.scopeLogsIndex, 0);
  assert.equal(result.issues[0]!.logRecordIndex, 0);
  assert.equal(result.issues[0]!.path, expectedPath);
  assert.equal(result.issues[0]!.code, expectedCode);
}

test("normalizes an official-shape record and preserves separated provenance", () => {
  const input = {
    resourceLogs: [
      {
        schemaUrl: "https://opentelemetry.io/schemas/1.31.0",
        resource: {
          droppedAttributesCount: 2,
          attributes: [
            stringAttribute("service.name", "checkout"),
            stringAttribute("deployment.environment.name", "production"),
            stringAttribute("deployment.environment", "legacy"),
            stringAttribute("region", "resource-region"),
          ],
        },
        scopeLogs: [
          {
            schemaUrl: "scope-schema",
            scope: {
              name: "@opentelemetry/instrumentation-http",
              version: "0.57.0",
              droppedAttributesCount: 1,
              attributes: [stringAttribute("region", "scope-region")],
            },
            logRecords: [
              logRecord({
                flags: 257,
                droppedAttributesCount: 3,
                eventName: "checkout.failure",
                attributes: [
                  stringAttribute("region", "record-region"),
                  stringAttribute(
                    "exception.stacktrace",
                    "Error: boom\n at checkout",
                  ),
                ],
              }),
            ],
          },
        ],
      },
    ],
  };
  const event = one(input);
  const data = otel(event);
  assert.equal(event.timestamp, "1970-01-01T00:00:01.250Z");
  assert.equal(event.service, "checkout");
  assert.equal(event.environment, "production");
  assert.equal(event.level, "error");
  assert.equal(event.message, "checkout failed");
  assert.equal(event.stackTrace, "Error: boom\n at checkout");
  assert.equal(event.traceId, TRACE_ID.toLowerCase());
  assert.equal(event.spanId, SPAN_ID.toLowerCase());
  assert.deepEqual(data.resourceAttributes, {
    "service.name": "checkout",
    "deployment.environment.name": "production",
    "deployment.environment": "legacy",
    region: "resource-region",
  });
  assert.deepEqual(data.scope, {
    name: "@opentelemetry/instrumentation-http",
    version: "0.57.0",
  });
  assert.deepEqual(data.scopeAttributes, { region: "scope-region" });
  assert.deepEqual(data.logAttributes, {
    region: "record-region",
    "exception.stacktrace": "Error: boom\n at checkout",
  });
  assert.equal(
    data.resourceSchemaUrl,
    "https://opentelemetry.io/schemas/1.31.0",
  );
  assert.equal(data.scopeSchemaUrl, "scope-schema");
  assert.equal(data.resourceDroppedAttributesCount, 2);
  assert.equal(data.scopeDroppedAttributesCount, 1);
  assert.equal(data.droppedAttributesCount, 3);
  assert.equal(data.timeUnixNano, "1250999999");
  assert.equal(data.observedTimeUnixNano, "2250999999");
  assert.equal(data.selectedTimestampField, "timeUnixNano");
  assert.equal(data.severityNumber, 17);
  assert.equal(data.severityText, "ERROR");
  assert.equal(data.eventName, "checkout.failure");
  assert.equal(data.bodyType, "stringValue");
  assert.equal(Object.hasOwn(data, "body"), false);
  assert.equal(data.flags, 257);
  assert.equal(data.traceFlags, 1);
  assert.equal(data.sampled, true);
});

test("uses observed time only when event time is absent or zero", () => {
  const absent = one(
    request([
      logRecord({
        timeUnixNano: undefined,
        observedTimeUnixNano: "3250999999",
      }),
    ]),
  );
  assert.equal(absent.timestamp, "1970-01-01T00:00:03.250Z");
  assert.equal(otel(absent).selectedTimestampField, "observedTimeUnixNano");
  assert.equal(Object.hasOwn(otel(absent), "timeUnixNano"), false);

  const zero = one(
    request([
      logRecord({
        timeUnixNano: "0",
        observedTimeUnixNano: "4250999999",
      }),
    ]),
  );
  assert.equal(zero.timestamp, "1970-01-01T00:00:04.250Z");
  assert.equal(otel(zero).timeUnixNano, "0");
  assert.equal(otel(zero).observedTimeUnixNano, "4250999999");
});

test("rejects records without either non-zero timestamp", () => {
  for (const overrides of [
    { timeUnixNano: undefined, observedTimeUnixNano: undefined },
    { timeUnixNano: "0", observedTimeUnixNano: "0" },
  ]) {
    rejectedRecord(
      overrides,
      LOG_PATH + ".timeUnixNano",
      "missing_timestamp",
    );
  }
});

test("requires safe numeric timestamps and accepts the UInt64 boundary", () => {
  for (const value of [
    Number.MAX_SAFE_INTEGER + 1,
    -1,
    "18446744073709551616",
    "not-an-integer",
  ]) {
    rejectedRecord({ timeUnixNano: value }, LOG_PATH + ".timeUnixNano");
  }
  const boundary = one(
    request([
      logRecord({
        timeUnixNano: "18446744073709551615",
        observedTimeUnixNano: undefined,
      }),
    ]),
  );
  assert.equal(otel(boundary).timeUnixNano, "18446744073709551615");
});

test("maps every severity range without letting text override the number", () => {
  const cases: Array<[number | undefined, LogEvent["level"]]> = [
    [undefined, "info"],
    [0, "info"],
    [1, "debug"],
    [4, "debug"],
    [5, "debug"],
    [8, "debug"],
    [9, "info"],
    [12, "info"],
    [13, "warn"],
    [16, "warn"],
    [17, "error"],
    [20, "error"],
    [21, "error"],
    [24, "error"],
  ];
  for (const [severityNumber, expected] of cases) {
    const event = one(
      request([
        logRecord({
          severityNumber,
          severityText: severityNumber === undefined ? "FATAL" : "TRACE",
        }),
      ]),
    );
    assert.equal(event.level, expected);
  }
});

test("rejects unsupported and non-numeric severity values", () => {
  for (const value of [-1, 25, 1.5, "17", Number.MAX_SAFE_INTEGER + 1]) {
    rejectedRecord(
      { severityNumber: value },
      LOG_PATH + ".severityNumber",
      "unsupported_severity_number",
    );
  }
});

test("maps string, scalar, structured and empty AnyValue bodies", () => {
  const bodies: Array<[unknown, string, string]> = [
    [{ stringValue: "plain" }, "plain", "stringValue"],
    [{ boolValue: true }, "true", "boolValue"],
    [
      { intValue: "9223372036854775807" },
      '"9223372036854775807"',
      "intValue",
    ],
    [{ doubleValue: "NaN" }, '"NaN"', "doubleValue"],
    [
      {
        arrayValue: {
          values: [{ intValue: 1 }, { stringValue: "two" }],
        },
      },
      '[1,"two"]',
      "arrayValue",
    ],
    [
      {
        kvlistValue: {
          values: [
            attribute("z", { intValue: 2 }),
            attribute("a", { intValue: 1 }),
          ],
        },
      },
      '{"a":1,"z":2}',
      "kvlistValue",
    ],
    [{}, "", "empty"],
    [undefined, "", "absent"],
  ];
  for (const [body, expectedMessage, expectedType] of bodies) {
    const event = one(request([logRecord({ body })]));
    assert.equal(event.message, expectedMessage);
    assert.equal(otel(event).bodyType, expectedType);
    if (expectedType !== "stringValue" && expectedType !== "absent") {
      assert.equal(Object.hasOwn(otel(event), "body"), true);
    }
  }
});

test("rejects unsafe numeric int64 and preserves exact int64 strings", () => {
  rejectedRecord(
    { body: { intValue: Number.MAX_SAFE_INTEGER + 1 } },
    LOG_PATH + ".body.intValue",
  );
  rejectedRecord(
    {
      attributes: [
        attribute("unsafe", { intValue: Number.MAX_SAFE_INTEGER + 1 }),
      ],
    },
    LOG_PATH + ".attributes[0].value.intValue",
  );
  const event = one(
    request([
      logRecord({
        attributes: [
          attribute("exact", { intValue: "-9223372036854775808" }),
        ],
      }),
    ]),
  );
  assert.deepEqual(otel(event).logAttributes, {
    exact: "-9223372036854775808",
  });
});

test("extracts only the standard string exception stack trace", () => {
  const mapped = one(
    request([
      logRecord({
        body: undefined,
        attributes: [
          stringAttribute("exception.message", "do not replace body"),
          stringAttribute("exception.stacktrace", "stack"),
        ],
      }),
    ]),
  );
  assert.equal(mapped.message, "");
  assert.equal(mapped.stackTrace, "stack");

  const notString = one(
    request([
      logRecord({
        attributes: [
          attribute("exception.stacktrace", { intValue: 5 }),
        ],
      }),
    ]),
  );
  assert.equal(notString.stackTrace, undefined);
});

test("normalizes valid IDs and warns for invalid optional context", () => {
  const valid = one(request());
  assert.equal(valid.traceId, TRACE_ID.toLowerCase());
  assert.equal(valid.spanId, SPAN_ID.toLowerCase());

  const invalidTrace = normalize(
    request([logRecord({ traceId: "bad", spanId: SPAN_ID })]),
  );
  assert.equal(invalidTrace.events.length, 1);
  assert.equal(invalidTrace.rejectedLogRecords, 0);
  assert.equal(invalidTrace.events[0]!.traceId, undefined);
  assert.equal(invalidTrace.events[0]!.spanId, undefined);
  assert.deepEqual(
    invalidTrace.issues.map((issue) => issue.code),
    ["invalid_trace_id_ignored", "orphan_span_id_ignored"],
  );
  assert.ok(invalidTrace.issues.every((issue) => issue.severity === "warning"));
  assert.ok(
    invalidTrace.issues.every((issue) => issue.path.startsWith(LOG_PATH)),
  );

  const invalidSpan = normalize(
    request([logRecord({ traceId: TRACE_ID, spanId: "0".repeat(16) })]),
  );
  assert.equal(invalidSpan.events[0]!.traceId, TRACE_ID.toLowerCase());
  assert.equal(invalidSpan.events[0]!.spanId, undefined);
  assert.equal(invalidSpan.issues[0]!.code, "invalid_span_id_ignored");

  const orphan = normalize(
    request([logRecord({ traceId: undefined, spanId: SPAN_ID })]),
  );
  assert.equal(orphan.events[0]!.traceId, undefined);
  assert.equal(orphan.events[0]!.spanId, undefined);
  assert.equal(orphan.issues[0]!.code, "orphan_span_id_ignored");
});

test("accepts UInt32 flags, masks trace flags and rejects invalid flags", () => {
  const boundary = one(request([logRecord({ flags: 4_294_967_295 })]));
  assert.equal(otel(boundary).flags, 4_294_967_295);
  assert.equal(otel(boundary).traceFlags, 255);
  assert.equal(otel(boundary).sampled, true);
  const quoted = one(request([logRecord({ flags: "1" })]));
  assert.equal(otel(quoted).flags, 1);
  assert.equal(otel(quoted).traceFlags, 1);
  for (const flags of [-1, 1.5, 4_294_967_296]) {
    rejectedRecord({ flags }, LOG_PATH + ".flags");
  }
});

test("retains input order and counts errors separately from warnings", () => {
  const result = normalize(
    request([
      logRecord({ body: { stringValue: "first" }, severityNumber: 9 }),
      logRecord({ body: { stringValue: "invalid" }, severityNumber: 99 }),
      logRecord({
        body: { stringValue: "third" },
        severityNumber: 13,
        traceId: "bad",
        spanId: undefined,
      }),
    ]),
  );
  assert.deepEqual(
    result.events.map((event) => event.message),
    ["first", "third"],
  );
  assert.deepEqual(
    result.events.map((event) => event.level),
    ["info", "warn"],
  );
  assert.equal(result.rejectedLogRecords, 1);
  assert.equal(result.hasUncountableRejections, false);
  assert.deepEqual(
    result.issues.map((issue) => [issue.severity, issue.code]),
    [
      ["error", "unsupported_severity_number"],
      ["warning", "invalid_trace_id_ignored"],
    ],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.logRecordIndex),
    [1, 2],
  );
});

test("counts records rejected by resource and scope failures", () => {
  const duplicateResource = normalize(
    request(
      [logRecord(), logRecord()],
      {
        resource: {
          attributes: [
            stringAttribute("duplicate", "one"),
            stringAttribute("duplicate", "two"),
          ],
        },
      },
    ),
  );
  assert.equal(duplicateResource.events.length, 0);
  assert.equal(duplicateResource.rejectedLogRecords, 2);
  assert.equal(duplicateResource.hasUncountableRejections, false);
  assert.equal(duplicateResource.issues.length, 1);
  assert.equal(duplicateResource.issues[0]!.scope, "resource");
  assert.equal(duplicateResource.issues[0]!.code, "duplicate_attribute");

  const duplicateScope = normalize(
    request(
      [logRecord()],
      {},
      {
        scope: {
          attributes: [
            stringAttribute("duplicate", "one"),
            stringAttribute("duplicate", "two"),
          ],
        },
      },
    ),
  );
  assert.equal(duplicateScope.rejectedLogRecords, 1);
  assert.equal(duplicateScope.hasUncountableRejections, false);
  assert.equal(duplicateScope.issues[0]!.scope, "scope");
});

test("marks malformed nested containers as uncountable", () => {
  for (const input of [
    { resourceLogs: [null] },
    {
      resourceLogs: [
        { scopeLogs: [{ logRecords: "not-an-array" }] },
      ],
    },
  ]) {
    const result = normalize(input);
    assert.equal(result.events.length, 0);
    assert.equal(result.rejectedLogRecords, 0);
    assert.equal(result.hasUncountableRejections, true);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0]!.severity, "error");
  }
});

test("enforces duplicate, count, complexity and byte limits", () => {
  rejectedRecord(
    {
      attributes: [
        stringAttribute("duplicate", "one"),
        stringAttribute("duplicate", "two"),
      ],
    },
    LOG_PATH + ".attributes[1].key",
    "duplicate_attribute",
  );
  rejectedRecord(
    {
      attributes: Array.from(
        { length: OTLP_LOG_LIMITS.attributesPerContainer + 1 },
        (_, index) => stringAttribute("key-" + index, "value"),
      ),
    },
    LOG_PATH + ".attributes",
    "metadata_limit_exceeded",
  );
  let nested: unknown = { stringValue: "leaf" };
  for (let index = 0; index < OTLP_LOG_LIMITS.attributeDepth + 2; index++) {
    nested = { arrayValue: { values: [nested] } };
  }
  rejectedRecord(
    { body: nested },
    LOG_PATH +
      ".body" +
      ".arrayValue.values[0]".repeat(OTLP_LOG_LIMITS.attributeDepth + 1),
    "metadata_limit_exceeded",
  );
  rejectedRecord(
    { body: { stringValue: "x".repeat(OTLP_LOG_LIMITS.metadataBytes + 1) } },
    LOG_PATH + ".body.stringValue",
    "metadata_limit_exceeded",
  );
});

test("handles prototype-like keys without mutation", () => {
  const event = one(
    request([
      logRecord({
        attributes: [
          stringAttribute("__proto__", "safe"),
          stringAttribute("constructor", "also-safe"),
        ],
      }),
    ]),
  );
  const logAttributes = otel(event).logAttributes as RecordValue;
  assert.equal(Object.hasOwn(logAttributes, "__proto__"), true);
  assert.equal(logAttributes["__proto__"], "safe");
  assert.equal(logAttributes.constructor, "also-safe");
  assert.equal(({} as RecordValue).polluted, undefined);
});

test("does not mutate input or share output metadata", () => {
  const input = request([
    logRecord({ body: { stringValue: "one" } }),
    logRecord({ body: { stringValue: "two" } }),
  ]);
  const before = JSON.stringify(input);
  const result = normalize(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.events.length, 2);
  const firstOtel = otel(result.events[0]!);
  const secondOtel = otel(result.events[1]!);
  assert.notEqual(firstOtel, secondOtel);
  (firstOtel.logAttributes as RecordValue).changed = true;
  assert.equal(
    (secondOtel.logAttributes as RecordValue).changed,
    undefined,
  );
});

test("accepts empty envelopes and throws for malformed top-level input", () => {
  const empty = {
    events: [],
    rejectedLogRecords: 0,
    hasUncountableRejections: false,
    issues: [],
  };
  assert.deepEqual(normalize({}), empty);
  assert.deepEqual(normalize({ resourceLogs: [] }), empty);
  assert.throws(() => normalize(null), OtlpLogNormalizationError);
  assert.throws(
    () => normalize({ resourceLogs: "not-an-array" }),
    OtlpLogNormalizationError,
  );
});
