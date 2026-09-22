import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { gzipSync } from "node:zlib";
import { test } from "node:test";

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import { logRoute } from "../routes/log.routes.js";
import {
  otlpLogRoute,
  type OtlpLogIngestionServiceLike,
  type OtlpLogRouteOptions,
} from "../routes/otlp-log.routes.js";
import type { LogEvent } from "../types/log-event.js";
import { LOCAL_DEVELOPMENT_APPLICATION_ID } from "../types/application.js";

const authenticator = {
  authenticateAuthorizationHeader: async () => LOCAL_DEVELOPMENT_APPLICATION_ID,
};

type RecordValue = Record<string, unknown>;
const TRACE_ID = "5B8EFFF798038103D269B633813FC60C";
const SPAN_ID = "EEE19B7EC3C1B174";

class FakeLogIngestionService implements OtlpLogIngestionServiceLike {
  readonly events: LogEvent[] = [];
  calls = 0;

  constructor(
    private readonly failOnCall?: number,
    private readonly failure = new Error("redis connection refused"),
  ) {}

  async ingest(event: LogEvent): Promise<unknown> {
    this.calls++;
    if (this.calls === this.failOnCall) throw this.failure;
    this.events.push(event);
    return { accepted: true, eventId: "event-" + this.calls };
  }
}

interface TestAppOptions {
  bodyLimitBytes?: number;
  capturedLogs?: string[];
}

async function withTestApp(
  logIngestionService: OtlpLogIngestionServiceLike,
  run: (app: FastifyInstance) => Promise<void>,
  options: TestAppOptions = {},
): Promise<void> {
  const app =
    options.capturedLogs === undefined
      ? Fastify({ logger: false })
      : Fastify({
          logger: {
            level: "warn",
            stream: new Writable({
              write(chunk, _encoding, callback) {
                options.capturedLogs?.push(chunk.toString());
                callback();
              },
            }),
          },
        });
  const routeOptions: OtlpLogRouteOptions = { logIngestionService, authenticator };
  if (options.bodyLimitBytes !== undefined) {
    routeOptions.bodyLimitBytes = options.bodyLimitBytes;
  }
  await app.register(otlpLogRoute, routeOptions);
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function stringAttribute(key: string, value: string): RecordValue {
  return { key, value: { stringValue: value } };
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

function resourceLogs(
  records: unknown[] = [logRecord()],
): RecordValue {
  return {
    resource: {
      attributes: [
        stringAttribute("service.name", "checkout-service"),
        stringAttribute("deployment.environment.name", "staging"),
      ],
    },
    scopeLogs: [
      {
        scope: { name: "demo-logger", version: "1.0" },
        logRecords: records,
      },
    ],
  };
}

function exportRequest(
  records: unknown[] = [logRecord()],
): RecordValue {
  return { resourceLogs: [resourceLogs(records)] };
}

function parseCapturedLogs(
  chunks: string[],
): Array<Record<string, unknown>> {
  return chunks
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("publishes a valid OTLP log and returns an empty response", async () => {
  const service = new FakeLogIngestionService();
  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      payload: exportRequest(),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {});
    assert.match(
      response.headers["content-type"] ?? "",
      /^application\/json/,
    );
  });
  assert.deepEqual(service.events, [
    {
      applicationId: LOCAL_DEVELOPMENT_APPLICATION_ID,
      timestamp: "1970-01-01T00:00:01.250Z",
      service: "checkout-service",
      level: "error",
      message: "checkout failed",
      traceId: TRACE_ID.toLowerCase(),
      spanId: SPAN_ID.toLowerCase(),
      environment: "staging",
      metadata: {
        otel: {
          resourceAttributes: {
            "service.name": "checkout-service",
            "deployment.environment.name": "staging",
          },
          scope: { name: "demo-logger", version: "1.0" },
          scopeAttributes: {},
          logAttributes: {},
          selectedTimestampField: "timeUnixNano",
          bodyType: "stringValue",
          flags: 0,
          traceFlags: 0,
          sampled: false,
          droppedAttributesCount: 0,
          timeUnixNano: "1250999999",
          observedTimeUnixNano: "2250999999",
          severityNumber: 17,
          severityText: "ERROR",
        },
      },
    },
  ]);
});

test("accepts an empty OTLP logs envelope without publishing", async () => {
  const service = new FakeLogIngestionService();
  await withTestApp(service, async (app) => {
    for (const payload of [{}, { resourceLogs: [] }]) {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/logs",
        payload,
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {});
    }
  });
  assert.deepEqual(service.events, []);
});

test("accepts gzip and ordinary JSON with absent Content-Encoding", async () => {
  const service = new FakeLogIngestionService();
  const compressed = gzipSync(
    Buffer.from(JSON.stringify(exportRequest())),
  );
  await withTestApp(service, async (app) => {
    const ordinary = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(exportRequest()),
    });
    assert.equal(ordinary.statusCode, 200);

    const gzip = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      payload: compressed,
    });
    assert.equal(gzip.statusCode, 200);
  });
  assert.equal(service.events.length, 2);
});

test("publishes healthy siblings and returns exact partial success", async () => {
  const service = new FakeLogIngestionService();
  const capturedLogs: string[] = [];
  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/logs",
        payload: exportRequest([
          logRecord({ body: { stringValue: "TOP_SECRET_VALID_BODY" } }),
          logRecord({
            severityNumber: 99,
            body: { stringValue: "TOP_SECRET_INVALID_BODY" },
          }),
        ]),
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        partialSuccess: {
          rejectedLogRecords: "1",
          errorMessage:
            "Rejected 1 invalid log record. First issue: " +
            "resourceLogs[0].scopeLogs[0].logRecords[1].severityNumber: " +
            "must be an integer OTLP severity value from 0 through 24",
        },
      });
    },
    { capturedLogs },
  );
  assert.equal(service.events.length, 1);
  assert.equal(service.events[0]!.message, "TOP_SECRET_VALID_BODY");
  const parsed = parseCapturedLogs(capturedLogs);
  const entry = parsed.find(
    (candidate) =>
      candidate.msg ===
      "OTLP log batch accepted with partial success or warnings",
  );
  assert.ok(entry);
  assert.equal(entry.acceptedLogRecords, 1);
  assert.equal(entry.rejectedLogRecords, 1);
  assert.deepEqual(entry.issues, [
    {
      code: "unsupported_severity_number",
      path:
        "resourceLogs[0].scopeLogs[0].logRecords[1].severityNumber",
      message:
        "must be an integer OTLP severity value from 0 through 24",
      severity: "error",
      scope: "log_record",
      resourceLogsIndex: 0,
      scopeLogsIndex: 0,
      logRecordIndex: 1,
    },
  ]);
  const diagnostics = JSON.stringify(parsed);
  assert.doesNotMatch(diagnostics, /TOP_SECRET_VALID_BODY/);
  assert.doesNotMatch(diagnostics, /TOP_SECRET_INVALID_BODY/);
});

test("publishes warning-only records with zero rejected count", async () => {
  const service = new FakeLogIngestionService();
  const capturedLogs: string[] = [];
  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/logs",
        payload: exportRequest([
          logRecord({ traceId: "bad", spanId: undefined }),
        ]),
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        partialSuccess: {
          rejectedLogRecords: "0",
          errorMessage:
            "Normalization warning. First issue: " +
            "resourceLogs[0].scopeLogs[0].logRecords[0].traceId: " +
            "invalid optional 32-character hexadecimal identifier was ignored",
        },
      });
    },
    { capturedLogs },
  );
  assert.equal(service.events.length, 1);
  assert.equal(service.events[0]!.traceId, undefined);
  const entry = parseCapturedLogs(capturedLogs).find(
    (candidate) =>
      candidate.msg ===
      "OTLP log batch accepted with partial success or warnings",
  );
  assert.ok(entry);
  assert.equal(entry.acceptedLogRecords, 1);
  assert.equal(entry.rejectedLogRecords, 0);
  const issues = entry.issues as Array<Record<string, unknown>>;
  assert.equal(issues[0]!.severity, "warning");
  assert.equal(issues[0]!.code, "invalid_trace_id_ignored");
});

test("returns 400 and publishes nothing when every record is invalid", async () => {
  const service = new FakeLogIngestionService();
  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      payload: exportRequest([
        logRecord({ severityNumber: 25 }),
        logRecord({ timeUnixNano: "0", observedTimeUnixNano: "0" }),
      ]),
    });
    assert.equal(response.statusCode, 400);
    assert.match(
      response.json().message,
      /contained no valid log records/,
    );
  });
  assert.deepEqual(service.events, []);
});

test("makes uncountable normalization failures atomic", async () => {
  const service = new FakeLogIngestionService();
  const capturedLogs: string[] = [];
  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/logs",
        payload: {
          resourceLogs: [
            resourceLogs([
              logRecord({ body: { stringValue: "valid sibling" } }),
            ]),
            { scopeLogs: [{ logRecords: "not-an-array" }] },
          ],
        },
      });
      assert.equal(response.statusCode, 400);
      assert.match(
        response.json().message,
        /complete rejected log record count could not be determined/,
      );
    },
    { capturedLogs },
  );
  assert.deepEqual(service.events, []);
  const entry = parseCapturedLogs(capturedLogs).find(
    (candidate) =>
      candidate.msg ===
      "OTLP log batch rejected because its rejected-record count is unknowable",
  );
  assert.ok(entry);
  assert.equal(entry.normalizedLogRecords, 1);
  assert.equal(entry.rejectedLogRecords, 0);
  assert.equal(entry.hasUncountableRejections, true);
});

test("rejects invalid top-level envelopes as permanent bad data", async () => {
  const service = new FakeLogIngestionService();
  await withTestApp(service, async (app) => {
    const nullResponse = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      headers: { "content-type": "application/json" },
      payload: "null",
    });
    assert.equal(nullResponse.statusCode, 400);
    assert.match(
      nullResponse.json().message,
      /Invalid OTLP log request/,
    );

    const containerResponse = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      payload: { resourceLogs: {} },
    });
    assert.equal(containerResponse.statusCode, 400);
    assert.match(
      containerResponse.json().message,
      /Invalid OTLP log request/,
    );
  });
  assert.deepEqual(service.events, []);
});

test("applies the body limit after gzip decompression", async () => {
  const service = new FakeLogIngestionService();
  const oversized = exportRequest([
    logRecord({ body: { stringValue: "x".repeat(4_096) } }),
  ]);
  const compressed = gzipSync(Buffer.from(JSON.stringify(oversized)));
  assert.ok(compressed.length < 1_024);
  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/logs",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
        payload: compressed,
      });
      assert.equal(response.statusCode, 413);
      assert.deepEqual(response.json(), {
        message:
          "OTLP request body exceeds the configured decompressed size limit.",
      });
    },
    { bodyLimitBytes: 1_024 },
  );
  assert.deepEqual(service.events, []);
});

test("rejects explicit identity encoding and protobuf compatibility", async () => {
  const service = new FakeLogIngestionService();
  await withTestApp(service, async (app) => {
    const identity = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      headers: {
        "content-type": "application/json",
        "content-encoding": "identity",
      },
      payload: JSON.stringify(exportRequest()),
    });
    assert.equal(identity.statusCode, 415);

    const protobuf = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      headers: { "content-type": "application/x-protobuf" },
      payload: Buffer.from([0]),
    });
    assert.equal(protobuf.statusCode, 415);
    assert.match(protobuf.json().message, /JSON-only compatibility/);
  });
  assert.deepEqual(service.events, []);
});

test("returns bounded errors for malformed JSON and invalid gzip", async () => {
  const service = new FakeLogIngestionService();
  await withTestApp(service, async (app) => {
    const malformed = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(malformed.statusCode, 400);
    assert.deepEqual(malformed.json(), {
      message: "Invalid OTLP/HTTP JSON request body.",
    });

    const invalidGzip = await app.inject({
      method: "POST",
      url: "/otlp/v1/logs",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      payload: Buffer.from("not-gzip"),
    });
    assert.equal(invalidGzip.statusCode, 400);
    assert.deepEqual(invalidGzip.json(), {
      message: "Invalid OTLP/HTTP JSON request body.",
    });
  });
  assert.deepEqual(service.events, []);
});

test("returns generic 503 and logs the published prefix on failure", async () => {
  const service = new FakeLogIngestionService(2);
  const capturedLogs: string[] = [];
  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/otlp/v1/logs",
        payload: exportRequest([
          logRecord({ body: { stringValue: "first" } }),
          logRecord({ body: { stringValue: "second" } }),
          logRecord({ body: { stringValue: "third" } }),
        ]),
      });
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), {
        message: "Log ingestion is temporarily unavailable.",
      });
      assert.doesNotMatch(response.body, /redis connection refused/);
    },
    { capturedLogs },
  );
  assert.equal(service.calls, 2);
  assert.equal(service.events.length, 1);
  assert.equal(service.events[0]!.message, "first");
  const entry = parseCapturedLogs(capturedLogs).find(
    (candidate) => candidate.msg === "OTLP log publishing failed",
  );
  assert.ok(entry);
  assert.equal(entry.normalizedLogRecords, 3);
  assert.equal(entry.publishedLogRecords, 1);
  assert.equal(entry.rejectedLogRecords, 0);
});

test("keeps the internal and OTLP log routes on distinct paths", async () => {
  const service = new FakeLogIngestionService();
  const app = Fastify({ logger: false });
  await app.register(otlpLogRoute, { logIngestionService: service, authenticator });
  await app.register(logRoute, { authenticator });
  try {
    await app.ready();
    assert.equal(
      app.hasRoute({ method: "POST", url: "/otlp/v1/logs" }),
      true,
    );
    assert.equal(
      app.hasRoute({ method: "POST", url: "/v1/logs" }),
      true,
    );
  } finally {
    await app.close();
  }
});
