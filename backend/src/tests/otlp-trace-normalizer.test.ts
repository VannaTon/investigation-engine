import assert from "node:assert/strict";

import {
  normalizeOtlpTraceRequest,
  OtlpTraceNormalizationError,
} from "../telemetry/otlp/otlp-trace-normalizer.js";

import type {
  OtlpExportTraceServiceRequest,
} from "../telemetry/otlp/otlp-trace.types.js";

const request: OtlpExportTraceServiceRequest = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "checkout-service" } },
          { key: "service.version", value: { stringValue: "1.2.3" } },
          {
            key: "deployment.environment.name",
            value: { stringValue: "production" },
          },
          {
            key: "large.counter",
            value: { intValue: "9223372036854775807" },
          },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: "5B8EFFF798038103D269B633813FC60C",
              spanId: "EEE19B7EC3C1B174",
              parentSpanId: "",
              name: "POST /checkout",
              startTimeUnixNano: "1000000000",
              endTimeUnixNano: "1250000000",
              attributes: [
                {
                  key: "http.request.method",
                  value: { stringValue: "POST" },
                },
                {
                  key: "deployment.environment.name",
                  value: { stringValue: "span-override" },
                },
                { key: "retry", value: { boolValue: false } },
                { key: "ratio", value: { doubleValue: 0.5 } },
                {
                  key: "flags",
                  value: {
                    arrayValue: {
                      values: [{ stringValue: "one" }, { intValue: "2" }],
                    },
                  },
                },
                {
                  key: "context",
                  value: {
                    kvlistValue: {
                      values: [
                        {
                          key: "region",
                          value: { stringValue: "ap-southeast-1" },
                        },
                      ],
                    },
                  },
                },
                { key: "payload", value: { bytesValue: "AQID" } },
              ],
              status: { code: 0 },
            },
            {
              traceId: "5b8efff798038103d269b633813fc60c",
              spanId: "1111111111111111",
              parentSpanId: "EEE19B7EC3C1B174",
              name: "charge payment",
              startTimeUnixNano: "1100000000",
              endTimeUnixNano: "1200000000",
              status: { code: 2 },
            },
          ],
        },
      ],
    },
    {
      resource: {
        attributes: [
          { key: "service.name", value: { intValue: "7" } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              spanId: "bbbbbbbbbbbbbbbb",
              name: "background job",
              startTimeUnixNano: 2_000_000_000,
              endTimeUnixNano: 2_001_000_000,
              status: { code: 1 },
            },
          ],
        },
      ],
    },
  ],
};

const result = normalizeOtlpTraceRequest({
  ...request,
  ignoredFutureField: true,
});

assert.equal(result.rejectedSpans, 0);
assert.deepEqual(result.issues, []);

const { spans } = result;
assert.equal(spans.length, 3);

const root = spans[0];
assert.ok(root);
assert.deepEqual(root, {
  traceId: "5b8efff798038103d269b633813fc60c",
  spanId: "eee19b7ec3c1b174",
  service: "checkout-service",
  operation: "POST /checkout",
  startTime: "1970-01-01T00:00:01.000Z",
  endTime: "1970-01-01T00:00:01.250Z",
  durationMs: 250,
  status: "ok",
  metadata: {
    otel: {
      resourceAttributes: {
        "service.name": "checkout-service",
        "service.version": "1.2.3",
        "deployment.environment.name": "production",
        "large.counter": "9223372036854775807",
      },
      spanAttributes: {
        "http.request.method": "POST",
        "deployment.environment.name": "span-override",
        retry: false,
        ratio: 0.5,
        flags: ["one", 2],
        context: { region: "ap-southeast-1" },
        payload: "AQID",
      },
    },
  },
});
assert.equal("parentSpanId" in root, false);

const child = spans[1];
assert.ok(child);
assert.equal(child.parentSpanId, "eee19b7ec3c1b174");
assert.equal(child.status, "error");
assert.equal(child.durationMs, 100);

const unknownService = spans[2];
assert.ok(unknownService);
assert.equal(unknownService.service, "unknown_service");
assert.equal(unknownService.status, "ok");
assert.equal(unknownService.durationMs, 1);

assert.deepEqual(normalizeOtlpTraceRequest({}), {
  spans: [],
  rejectedSpans: 0,
  issues: [],
});

function expectNormalizationError(
  input: unknown,
  expectedPath: string,
): void {
  assert.throws(
    () => normalizeOtlpTraceRequest(input),
    (error: unknown) =>
      error instanceof OtlpTraceNormalizationError &&
      error.path === expectedPath,
  );
}

function spanFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    spanId: "bbbbbbbbbbbbbbbb",
    name: "operation",
    startTimeUnixNano: "1000000000",
    endTimeUnixNano: "2000000000",
    ...overrides,
  };
}

function singleSpan(overrides: Record<string, unknown>): unknown {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [spanFixture(overrides)],
          },
        ],
      },
    ],
  };
}

function expectRejectedSpan(
  input: unknown,
  expectedPath: string,
  expectedMessage?: RegExp,
): void {
  const rejected = normalizeOtlpTraceRequest(input);

  assert.equal(rejected.spans.length, 0);
  assert.equal(rejected.rejectedSpans, 1);
  assert.equal(rejected.issues.length, 1);

  const issue = rejected.issues[0];
  assert.ok(issue);
  assert.equal(issue.path, expectedPath);
  assert.equal(issue.resourceSpansIndex, 0);
  assert.equal(issue.scopeSpansIndex, 0);
  assert.equal(issue.spanIndex, 0);

  if (expectedMessage !== undefined) {
    assert.match(issue.message, expectedMessage);
  }
}

expectRejectedSpan(
  singleSpan({ traceId: "abc" }),
  "resourceSpans[0].scopeSpans[0].spans[0].traceId",
);
expectRejectedSpan(
  singleSpan({ spanId: "0000000000000000" }),
  "resourceSpans[0].scopeSpans[0].spans[0].spanId",
);
expectRejectedSpan(
  singleSpan({ parentSpanId: "bad-parent" }),
  "resourceSpans[0].scopeSpans[0].spans[0].parentSpanId",
);
expectRejectedSpan(
  singleSpan({ startTimeUnixNano: "not-a-timestamp" }),
  "resourceSpans[0].scopeSpans[0].spans[0].startTimeUnixNano",
);
expectRejectedSpan(
  singleSpan({ startTimeUnixNano: Number.MAX_SAFE_INTEGER + 1 }),
  "resourceSpans[0].scopeSpans[0].spans[0].startTimeUnixNano",
);
expectRejectedSpan(
  singleSpan({
    startTimeUnixNano: "2000000000",
    endTimeUnixNano: "1000000000",
  }),
  "resourceSpans[0].scopeSpans[0].spans[0].endTimeUnixNano",
);

const fractionalDuration = normalizeOtlpTraceRequest(
  singleSpan({
    startTimeUnixNano: "1000000000",
    endTimeUnixNano: "1004200967",
  }),
);
assert.equal(fractionalDuration.spans[0]?.durationMs, 4);

const subMillisecondDuration = normalizeOtlpTraceRequest(
  singleSpan({
    startTimeUnixNano: "1000000000",
    endTimeUnixNano: "1000999999",
  }),
);
assert.equal(subMillisecondDuration.spans[0]?.durationMs, 0);

const uint32BoundaryDuration = normalizeOtlpTraceRequest(
  singleSpan({
    startTimeUnixNano: "0",
    endTimeUnixNano: "4294967295000000",
  }),
);
assert.equal(uint32BoundaryDuration.spans[0]?.durationMs, 4_294_967_295);

expectRejectedSpan(
  singleSpan({
    startTimeUnixNano: "0",
    endTimeUnixNano: "4294967296000000",
  }),
  "resourceSpans[0].scopeSpans[0].spans[0].endTimeUnixNano",
  /greater than the UInt32 maximum of 4294967295 milliseconds/,
);

expectRejectedSpan(
  singleSpan({
    attributes: [
      {
        key: "unsafe.counter",
        value: { intValue: Number.MAX_SAFE_INTEGER + 1 },
      },
    ],
  }),
  "resourceSpans[0].scopeSpans[0].spans[0].attributes[0].value.intValue",
);
expectRejectedSpan(
  singleSpan({ status: { code: "STATUS_CODE_ERROR" } }),
  "resourceSpans[0].scopeSpans[0].spans[0].status.code",
);
expectRejectedSpan(
  singleSpan({ status: { code: 3 } }),
  "resourceSpans[0].scopeSpans[0].spans[0].status.code",
  /unsupported OTLP status code 3/,
);

const mixedResult = normalizeOtlpTraceRequest({
  resourceSpans: [
    {
      scopeSpans: [
        {
          spans: [
            spanFixture({ spanId: "cccccccccccccccc" }),
            spanFixture({ spanId: "0000000000000000" }),
          ],
        },
      ],
    },
  ],
});

assert.equal(mixedResult.spans.length, 1);
assert.equal(mixedResult.rejectedSpans, 1);
assert.deepEqual(mixedResult.issues[0], {
  path: "resourceSpans[0].scopeSpans[0].spans[1].spanId",
  message: "must be a non-zero 16-character hexadecimal string",
  resourceSpansIndex: 0,
  scopeSpansIndex: 0,
  spanIndex: 1,
});

const resourceFailureResult = normalizeOtlpTraceRequest({
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: "service.name" }],
      },
      scopeSpans: [{ spans: [spanFixture()] }],
    },
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "healthy-service" } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            spanFixture({
              traceId: "dddddddddddddddddddddddddddddddd",
              spanId: "eeeeeeeeeeeeeeee",
            }),
          ],
        },
      ],
    },
  ],
});

assert.equal(resourceFailureResult.spans.length, 1);
assert.equal(resourceFailureResult.spans[0]?.service, "healthy-service");
assert.equal(resourceFailureResult.rejectedSpans, 1);
assert.deepEqual(resourceFailureResult.issues[0], {
  path: "resourceSpans[0].resource.attributes[0].value",
  message: "is required",
  resourceSpansIndex: 0,
  scopeSpansIndex: 0,
  spanIndex: 0,
});

expectNormalizationError(
  { resourceSpans: {} },
  "request.resourceSpans",
);

console.log("OTLP trace normalizer tests passed.");
