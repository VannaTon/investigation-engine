import assert from "node:assert/strict";
import type { RedisClientType } from "redis";
import { test } from "node:test";
import {
  isHistogramMetricRecoveryEnabled,
  isOtlpExplicitHistogramsEnabled,
} from "../config/histogram-metrics.js";
import { GROUPS, STREAMS } from "../constants/stream.js";
import {
  HistogramMetricRepository,
  decodeHistogramMetricCursor,
} from "../repository/histogram-metric.repository.js";
import {
  HISTOGRAM_METRIC_REQUIRED_DEDUPLICATION_WINDOW,
  HistogramMetricStorageReadinessService,
} from "../services/histogram-metric-storage-readiness.service.js";
import type { HistogramMetricEvent } from "../types/histogram-metric-event.js";
import { StreamMessageHandler } from "../worker/handler/stream-message.handler.js";
import {
  HistogramMetricProcessor,
  histogramMetricInsertDeduplicationToken,
} from "../worker/processor/histogram-metric.processor.js";
import type { StreamProcessingContext } from "../worker/processor/processor.js";
import type { DlqPublisher } from "../worker/publisher/dlq.publisher.js";
import { HistogramMetricPublisher } from "../worker/publisher/histogram-metric.publisher.js";
import {
  HISTOGRAM_METRIC_RECOVERY_FAILURE_CODE,
  HistogramMetricRecoveryService,
} from "../worker/recovery/histogram-metric-recovery.service.js";
import { StreamProcessingError } from "../worker/stream-processing.error.js";
import {
  LOCAL_DEVELOPMENT_APPLICATION_ID,
  type ApplicationTelemetry,
} from "../types/application.js";

const MESSAGE_ID = "1788685323456-0";
const CONSUMER = "metric_histogram_workers-test";
const UINT64_MAX = "18446744073709551615";

const event: ApplicationTelemetry<HistogramMetricEvent> = {
  applicationId: LOCAL_DEVELOPMENT_APPLICATION_ID,
  timestamp: "2026-09-06T01:02:03.456Z",
  service: "checkout-service",
  name: "http.server.duration",
  type: "histogram",
  unit: "ms",
  temporality: "cumulative",
  count: UINT64_MAX,
  sum: 42,
  min: 1,
  max: 10,
  bucketCounts: [UINT64_MAX],
  explicitBounds: [],
  metadata: {
    otel: {
      timeUnixNano: "1788685323456789000",
    },
  },
};

const context: StreamProcessingContext = {
  messageId: MESSAGE_ID,
  streamName: STREAMS.METRIC_HISTOGRAMS,
  groupName: GROUPS.METRIC_HISTOGRAM_WORKERS,
  consumerName: CONSUMER,
};

function asRedis(methods: Record<string, unknown>): RedisClientType {
  return methods as unknown as RedisClientType;
}

function asDlq(
  publishFields: (fields: Record<string, string>) => Promise<string>,
): DlqPublisher {
  return { publishFields } as unknown as DlqPublisher;
}

test("histogram feature and recovery flags are explicit and default off", () => {
  assert.equal(isOtlpExplicitHistogramsEnabled({}), false);
  assert.equal(
    isOtlpExplicitHistogramsEnabled({
      OTLP_EXPLICIT_HISTOGRAMS_ENABLED: "true",
    }),
    true,
  );
  assert.equal(
    isOtlpExplicitHistogramsEnabled({
      OTLP_EXPLICIT_HISTOGRAMS_ENABLED: "TRUE",
    }),
    false,
  );

  assert.equal(isHistogramMetricRecoveryEnabled({}), false);
  assert.equal(
    isHistogramMetricRecoveryEnabled({
      HISTOGRAM_METRIC_RECOVERY_ENABLED: "true",
    }),
    true,
  );
});

test("publisher writes only to the dedicated histogram stream", async () => {
  const calls: unknown[][] = [];
  const publisher = new HistogramMetricPublisher(
    asRedis({
      xAdd: async (...args: unknown[]) => {
        calls.push(args);
        return MESSAGE_ID;
      },
    }),
  );

  assert.equal(await publisher.publish(event), MESSAGE_ID);
  assert.deepEqual(calls, [
    [
      STREAMS.METRIC_HISTOGRAMS,
      "*",
      { event: JSON.stringify(event) },
    ],
  ]);
});

test("repository preserves exact UInt64 strings and the stable insertion token", async () => {
  let insertRequest: unknown;
  const repository = new HistogramMetricRepository(
    {
      insert: async (request: unknown) => {
        insertRequest = request;
        return {} as never;
      },
      query: async () => {
        throw new Error("query was not expected");
      },
    } as never,
  );

  await repository.save(event, {
    streamMessageId: MESSAGE_ID,
    deduplicationToken:
      histogramMetricInsertDeduplicationToken(MESSAGE_ID),
  });

  assert.deepEqual(insertRequest, {
    table: "metric_histograms",
    values: [
      {
        application_id: event.applicationId,
        timestamp: event.timestamp,
        service: event.service,
        name: event.name,
        temporality: event.temporality,
        count: UINT64_MAX,
        sum: 42,
        min: 1,
        max: 10,
        bucket_counts: [UINT64_MAX],
        explicit_bounds: [],
        unit: "ms",
        metadata: JSON.stringify(event.metadata),
        stream_message_id: MESSAGE_ID,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: {
      insert_deduplication_token:
        "metric_histograms:metric_histogram_workers:" + MESSAGE_ID,
    },
  });
});

test("raw histogram query keeps UInt64 values as strings and uses a composite cursor", async () => {
  let queryRequest: unknown;
  const repository = new HistogramMetricRepository(
    {
      insert: async () => ({} as never),
      query: async (request: unknown) => {
        queryRequest = request;

        return {
          json: async () => [
            {
              timestamp: "2026-09-06 01:02:03.456",
              service: event.service,
              name: event.name,
              temporality: event.temporality,
              count: UINT64_MAX,
              sum: 42,
              application_id: LOCAL_DEVELOPMENT_APPLICATION_ID,
              min: 1,
              max: 10,
              bucket_counts: [UINT64_MAX],
              explicit_bounds: [],
              unit: "ms",
              metadata: JSON.stringify(event.metadata),
              stream_message_id: MESSAGE_ID,
            },
            {
              timestamp: "2026-09-06 01:02:03.455",
              service: event.service,
              name: event.name,
              temporality: event.temporality,
              count: "1",
              sum: null,
              min: null,
              max: null,
              bucket_counts: [],
              explicit_bounds: [],
              unit: null,
              metadata: "{}",
              stream_message_id: "1788685323455-0",
            },
          ],
        };
      },
    } as never,
  );

  const result = await repository.find({
    service: event.service,
    applicationId: LOCAL_DEVELOPMENT_APPLICATION_ID,
    name: event.name,
    limit: 1,
  });

  assert.equal(result.hasMore, true);
  assert.equal(result.data[0]?.count, UINT64_MAX);
  assert.deepEqual(result.data[0]?.bucketCounts, [UINT64_MAX]);
  assert.ok(result.nextCursor);
  assert.deepEqual(decodeHistogramMetricCursor(result.nextCursor), {
    timestamp: event.timestamp,
    streamMessageId: MESSAGE_ID,
  });

  const request = queryRequest as {
    query: string;
    query_params: Record<string, unknown>;
    clickhouse_settings: Record<string, unknown>;
  };
  assert.match(
    request.query,
    /ORDER BY timestamp DESC, stream_message_id DESC/,
  );
  assert.equal(request.query_params.limit, 2);
  assert.equal(
    request.clickhouse_settings.output_format_json_quote_64bit_integers,
    1,
  );

  await assert.rejects(
    repository.find({ applicationId: LOCAL_DEVELOPMENT_APPLICATION_ID, cursor: "not-a-valid-cursor" }),
    /Histogram metric cursor is invalid/,
  );
});

test("processor uses one stable token per Redis message and has no alert stage", async () => {
  const saves: Array<{
    event: HistogramMetricEvent;
    options: Record<string, unknown>;
  }> = [];
  const repository = {
    async save(
      savedEvent: HistogramMetricEvent,
      options: Record<string, unknown>,
    ) {
      saves.push({ event: savedEvent, options });
    },
  };
  const processor = new HistogramMetricProcessor(repository as never);

  await processor.process(event, context);
  await processor.process(event, context);

  assert.equal(saves.length, 2);
  assert.deepEqual(saves.map((save) => save.options), [
    {
      streamMessageId: MESSAGE_ID,
      deduplicationToken:
        "metric_histograms:metric_histogram_workers:" + MESSAGE_ID,
    },
    {
      streamMessageId: MESSAGE_ID,
      deduplicationToken:
        "metric_histograms:metric_histogram_workers:" + MESSAGE_ID,
    },
  ]);

  const failing = new HistogramMetricProcessor(
    {
      async save() {
        throw new Error("ClickHouse unavailable");
      },
    } as never,
  );

  await assert.rejects(
    failing.process(event, context),
    (error: unknown) => {
      assert.ok(error instanceof StreamProcessingError);
      assert.equal(error.stage, "clickhouse_save");
      assert.equal(error.diagnosticFields.messageId, MESSAGE_ID);
      assert.equal(error.diagnosticFields.temporality, "cumulative");
      return true;
    },
  );
});

test("histogram readiness requires a plain MergeTree and the 10000 dedupe window", async () => {
  assert.equal(
    HISTOGRAM_METRIC_REQUIRED_DEDUPLICATION_WINDOW,
    10_000,
  );

  const ready = new HistogramMetricStorageReadinessService(
    {
      query: async () => ({
        json: async () => [
          {
            engine: "MergeTree",
            engine_full:
              "MergeTree ORDER BY (service, name, timestamp, stream_message_id) " +
              "SETTINGS non_replicated_deduplication_window = 10000",
          },
        ],
      }),
    } as never,
  );

  assert.deepEqual(await ready.assertReady(), {
    engine: "MergeTree",
    configuredWindow: 10_000,
    requiredWindow: 10_000,
  });

  const missing = new HistogramMetricStorageReadinessService(
    {
      query: async () => ({
        json: async () => [],
      }),
    } as never,
  );
  await assert.rejects(
    missing.assertReady(),
    /observability\.metric_histograms table/,
  );
});

test("attempt three publishes the histogram DLQ record before acknowledging the source", async () => {
  const operations: string[] = [];
  const dlqRecords: Array<Record<string, string>> = [];
  const message = {
    id: MESSAGE_ID,
    message: { event: JSON.stringify(event) },
  };
  const redis = asRedis({
    xAutoClaim: async (...args: unknown[]) => {
      assert.deepEqual(args, [
        STREAMS.METRIC_HISTOGRAMS,
        GROUPS.METRIC_HISTOGRAM_WORKERS,
        CONSUMER,
        60_000,
        "0-0",
        { COUNT: 1 },
      ]);

      return {
        nextId: "0-0",
        messages: [message],
        deletedMessages: [],
      };
    },
    xPendingRange: async () => [
      {
        id: MESSAGE_ID,
        consumer: CONSUMER,
        millisecondsSinceLastDelivery: 0,
        deliveriesCounter: 3,
      },
    ],
    xAck: async () => {
      operations.push("ack");
      return 1;
    },
  });
  const handler = new StreamMessageHandler<HistogramMetricEvent>(
    redis,
    STREAMS.METRIC_HISTOGRAMS,
    GROUPS.METRIC_HISTOGRAM_WORKERS,
    {
      async process() {
        throw new StreamProcessingError(
          "clickhouse_save",
          "ClickHouse unavailable",
        );
      },
    },
    {
      consumerName: CONSUMER,
      requireSingleAcknowledgement: true,
    },
  );
  const recovery = new HistogramMetricRecoveryService(
    redis,
    handler,
    asDlq(async (fields) => {
      operations.push("dlq");
      dlqRecords.push(fields);
      return "1788685400000-0";
    }),
    CONSUMER,
    { now: () => new Date("2026-09-06T01:10:00.000Z") },
  );

  await recovery.runSweep();

  assert.deepEqual(operations, ["dlq", "ack"]);
  assert.deepEqual(dlqRecords, [
    {
      sourceStream: STREAMS.METRIC_HISTOGRAMS,
      sourceGroup: GROUPS.METRIC_HISTOGRAM_WORKERS,
      originalMessageId: MESSAGE_ID,
      recoveryConsumer: CONSUMER,
      deliveryCount: "3",
      attemptLimit: "3",
      failureCode: HISTOGRAM_METRIC_RECOVERY_FAILURE_CODE,
      failureStage: "clickhouse_save",
      failureMessage: "ClickHouse unavailable",
      originalFields: JSON.stringify(message.message),
      failedAt: "2026-09-06T01:10:00.000Z",
    },
  ]);
});

test("a histogram DLQ publication failure leaves the source pending", async () => {
  let acknowledgements = 0;
  const message = {
    id: MESSAGE_ID,
    message: { event: JSON.stringify(event) },
  };
  const redis = asRedis({
    xAutoClaim: async () => ({
      nextId: "0-0",
      messages: [message],
      deletedMessages: [],
    }),
    xPendingRange: async () => [
      {
        id: MESSAGE_ID,
        consumer: CONSUMER,
        millisecondsSinceLastDelivery: 0,
        deliveriesCounter: 3,
      },
    ],
    xAck: async () => {
      acknowledgements++;
      return 1;
    },
  });
  const recovery = new HistogramMetricRecoveryService(
    redis,
    new StreamMessageHandler<HistogramMetricEvent>(
      redis,
      STREAMS.METRIC_HISTOGRAMS,
      GROUPS.METRIC_HISTOGRAM_WORKERS,
      {
        async process() {
          throw new StreamProcessingError(
            "clickhouse_save",
            "ClickHouse unavailable",
          );
        },
      },
      {
        consumerName: CONSUMER,
        requireSingleAcknowledgement: true,
      },
    ),
    asDlq(async () => {
      throw new Error("DLQ unavailable");
    }),
    CONSUMER,
  );

  await recovery.runSweep();
  assert.equal(acknowledgements, 0);
});
