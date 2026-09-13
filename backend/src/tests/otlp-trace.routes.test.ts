import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { gzipSync } from "node:zlib";

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import {
  otlpTraceRoute,
  type OtlpSpanIngestionServiceLike,
  type OtlpTraceRouteOptions,
} from "../routes/otlp-trace.routes.js";

import type { Span } from "../types/span.js";

class FakeSpanIngestionService
  implements OtlpSpanIngestionServiceLike
{
  readonly spans: Span[] = [];

  constructor(private readonly failure?: Error) {}

  async ingest(span: Span) {
    if (this.failure !== undefined) {
      throw this.failure;
    }

    this.spans.push(span);

    return {
      accepted: true,
      eventId: `event-${this.spans.length}`,
    };
  }
}

interface TestAppOptions {
  bodyLimitBytes?: number;
  capturedLogs?: string[];
}

async function withTestApp(
  spanIngestionService: OtlpSpanIngestionServiceLike,
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

  const routeOptions: OtlpTraceRouteOptions = {
    spanIngestionService,
  };

  if (options.bodyLimitBytes !== undefined) {
    routeOptions.bodyLimitBytes = options.bodyLimitBytes;
  }

  await app.register(otlpTraceRoute, routeOptions);

  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function spanFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    traceId: "5B8EFFF798038103D269B633813FC60C",
    spanId: "EEE19B7EC3C1B174",
    parentSpanId: "",
    name: "POST /checkout",
    startTimeUnixNano: "1000000000",
    endTimeUnixNano: "1250000000",
    status: { code: 0 },
    ...overrides,
  };
}

function exportRequest(spans: unknown[]): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "checkout-service" },
            },
          ],
        },
        scopeSpans: [{ spans }],
      },
    ],
  };
}

function parseCapturedLogs(chunks: string[]): Array<Record<string, unknown>> {
  return chunks
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// Full success uses OTLP's empty ExportTraceServiceResponse.
{
  const service = new FakeSpanIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/traces",
      payload: exportRequest([
        spanFixture({
          attributes: [
            {
              key: "http.request.method",
              value: { stringValue: "POST" },
            },
          ],
        }),
      ]),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {});
    assert.match(
      response.headers["content-type"] ?? "",
      /^application\/json/,
    );
  });

  assert.deepEqual(service.spans, [
    {
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
          },
          spanAttributes: {
            "http.request.method": "POST",
          },
        },
      },
    },
  ]);
}

// Empty telemetry envelopes are successful and publish nothing.
{
  const service = new FakeSpanIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/traces",
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {});
  });

  assert.deepEqual(service.spans, []);
}

// Gzip is accepted when Content-Encoding explicitly selects it.
{
  const service = new FakeSpanIngestionService();
  const compressed = gzipSync(
    Buffer.from(JSON.stringify(exportRequest([spanFixture()]))),
  );

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/traces",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      payload: compressed,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {});
  });

  assert.equal(service.spans.length, 1);
}

// A malformed span does not discard valid spans in the same batch.
{
  const service = new FakeSpanIngestionService();
  const capturedLogs: string[] = [];

  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/traces",
        payload: exportRequest([
          spanFixture(),
          spanFixture({ spanId: "0000000000000000" }),
        ]),
      });

      assert.equal(response.statusCode, 200);

      const body = response.json();
      assert.equal(body.partialSuccess.rejectedSpans, "1");
      assert.match(
        body.partialSuccess.errorMessage,
        /resourceSpans\[0\]\.scopeSpans\[0\]\.spans\[1\]\.spanId/,
      );
    },
    { capturedLogs },
  );

  assert.equal(service.spans.length, 1);

  const partialLog = parseCapturedLogs(capturedLogs).find(
    (entry) => entry.msg === "OTLP trace batch partially accepted",
  );
  assert.ok(partialLog);
  assert.equal(partialLog.acceptedSpans, 1);
  assert.equal(partialLog.rejectedSpans, 1);
  assert.deepEqual(partialLog.issues, [
    {
      path: "resourceSpans[0].scopeSpans[0].spans[1].spanId",
      message: "must be a non-zero 16-character hexadecimal string",
      resourceSpansIndex: 0,
      scopeSpansIndex: 0,
      spanIndex: 1,
    },
  ]);
}

// A batch with no valid spans is a permanent bad-data response.
{
  const service = new FakeSpanIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/traces",
      payload: exportRequest([
        spanFixture({ status: { code: 3 } }),
      ]),
    });

    assert.equal(response.statusCode, 400);
    assert.match(
      response.json().message,
      /contained no valid spans.*unsupported OTLP status code 3/,
    );
  });

  assert.deepEqual(service.spans, []);
}

// An unreadable request container fails the whole request.
{
  const service = new FakeSpanIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/traces",
      payload: { resourceSpans: {} },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().message, /request\.resourceSpans/);
  });

  assert.deepEqual(service.spans, []);
}

// The body limit applies after gzip decompression.
{
  const service = new FakeSpanIngestionService();
  const oversizedRequest = exportRequest([
    spanFixture({
      attributes: [
        {
          key: "large.value",
          value: { stringValue: "x".repeat(4_096) },
        },
      ],
    }),
  ]);
  const compressed = gzipSync(
    Buffer.from(JSON.stringify(oversizedRequest)),
  );

  assert.ok(compressed.length < 1_024);

  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/traces",
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

  assert.deepEqual(service.spans, []);
}

// Uncompressed JSON is represented by an absent Content-Encoding header.
{
  const service = new FakeSpanIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/traces",
      headers: {
        "content-type": "application/json",
        "content-encoding": "identity",
      },
      payload: JSON.stringify(exportRequest([spanFixture()])),
    });

    assert.equal(response.statusCode, 415);
  });

  assert.deepEqual(service.spans, []);
}

// Binary protobuf compatibility is intentionally deferred.
{
  const service = new FakeSpanIngestionService();

  await withTestApp(service, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/traces",
      headers: {
        "content-type": "application/x-protobuf",
      },
      payload: Buffer.from([0]),
    });

    assert.equal(response.statusCode, 415);
    assert.match(response.json().message, /JSON-only compatibility/);
  });

  assert.deepEqual(service.spans, []);
}

// Redis/publisher failures are retryable and do not expose internals.
{
  const service = new FakeSpanIngestionService(
    new Error("redis connection refused"),
  );
  const capturedLogs: string[] = [];

  await withTestApp(
    service,
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/traces",
        payload: exportRequest([spanFixture()]),
      });

      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), {
        message: "Trace ingestion is temporarily unavailable.",
      });
      assert.doesNotMatch(response.body, /redis connection refused/);
    },
    { capturedLogs },
  );

  const failureLog = parseCapturedLogs(capturedLogs).find(
    (entry) => entry.msg === "OTLP trace publishing failed",
  );
  assert.ok(failureLog);
  assert.equal(failureLog.normalizedSpans, 1);
}

console.log("OTLP trace route tests passed.");
