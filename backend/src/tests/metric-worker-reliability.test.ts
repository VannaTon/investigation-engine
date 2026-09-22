import assert from "node:assert/strict";
import type { RedisClientType } from "redis";
import { isMetricRecoveryEnabled } from "../config/metric-recovery.js";
import { GROUPS, STREAMS } from "../constants/stream.js";
import { MetricRepository } from "../repository/metric.repository.js";
import {
  METRIC_REQUIRED_DEDUPLICATION_WINDOW,
  MetricStorageReadinessService,
  parseNonReplicatedDeduplicationWindow,
} from "../services/metric-storage-readiness.service.js";
import type { MetricAlertEvaluator } from "../services/metric-alert-evaluator.js";
import type { MetricEvent } from "../types/metric-event.js";
import { StreamMessageHandler } from "../worker/handler/stream-message.handler.js";
import {
  MetricProcessor,
  metricInsertDeduplicationToken,
} from "../worker/processor/metric.processor.js";
import type { StreamProcessingContext } from "../worker/processor/processor.js";
import { StreamProcessingError } from "../worker/stream-processing.error.js";
import {
  LOCAL_DEVELOPMENT_APPLICATION_ID,
  type ApplicationTelemetry,
} from "../types/application.js";

const MESSAGE_ID = "1788594646353-0";
const CONSUMER_NAME = "metric_workers-test";
const metric: ApplicationTelemetry<MetricEvent> = {
  applicationId: LOCAL_DEVELOPMENT_APPLICATION_ID,
  timestamp: "2026-09-05T07:50:46.336Z",
  service: "phase5e-test",
  name: "nodejs.eventloop.time",
  type: "counter",
  value: 0.08,
  unit: "s",
};
const context: StreamProcessingContext = {
  messageId: MESSAGE_ID,
  streamName: STREAMS.METRICS,
  groupName: GROUPS.METRIC_WORKERS,
  consumerName: CONSUMER_NAME,
};

function asRedis(methods: Record<string, unknown>): RedisClientType {
  return methods as unknown as RedisClientType;
}

function readinessWith(
  engineFull: string,
  engine = "MergeTree",
): MetricStorageReadinessService {
  return new MetricStorageReadinessService(
    {
      query: async () => ({
        json: async () => [
          {
            engine,
            engine_full: engineFull,
          },
        ],
      }),
    } as never,
  );
}

async function expectStage(
  promise: Promise<unknown>,
  expectedStage: StreamProcessingError["stage"],
): Promise<StreamProcessingError> {
  let caught: StreamProcessingError | undefined;

  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof StreamProcessingError);
    caught = error;
    assert.equal(error.stage, expectedStage);
    return true;
  });

  assert.ok(caught);
  return caught;
}

async function main(): Promise<void> {
  assert.equal(METRIC_REQUIRED_DEDUPLICATION_WINDOW, 10_000);
  assert.equal(
    parseNonReplicatedDeduplicationWindow(
      "MergeTree ORDER BY (service, name, timestamp) SETTINGS " +
        "index_granularity = 8192, non_replicated_deduplication_window = 10000",
    ),
    10_000,
  );
  assert.equal(
    parseNonReplicatedDeduplicationWindow(
      "MergeTree ORDER BY timestamp SETTINGS index_granularity = 8192",
    ),
    undefined,
  );

  assert.equal(isMetricRecoveryEnabled({}), false);
  assert.equal(isMetricRecoveryEnabled({ METRIC_RECOVERY_ENABLED: "false" }), false);
  assert.equal(isMetricRecoveryEnabled({ METRIC_RECOVERY_ENABLED: "true" }), true);

  {
    const readiness = readinessWith(
      "MergeTree ORDER BY timestamp SETTINGS " +
        "non_replicated_deduplication_window = 10000",
    );
    assert.deepEqual(await readiness.assertReady(), {
      engine: "MergeTree",
      configuredWindow: 10_000,
      requiredWindow: 10_000,
    });
  }

  await assert.rejects(
    readinessWith(
      "MergeTree ORDER BY timestamp SETTINGS " +
        "non_replicated_deduplication_window = 9999",
    ).assertReady(),
    /requires non_replicated_deduplication_window >= 10000; found 9999/,
  );
  await assert.rejects(
    readinessWith(
      "ReplicatedMergeTree('/clickhouse/tables/metrics', '{replica}') " +
        "ORDER BY timestamp SETTINGS " +
        "non_replicated_deduplication_window = 10000",
      "ReplicatedMergeTree",
    ).assertReady(),
    /requires the non-replicated MergeTree metrics table/,
  );

  {
    let insertRequest: unknown;
    const repository = new MetricRepository(
      {
        insert: async (request: unknown) => {
          insertRequest = request;
          return {} as never;
        },
      } as never,
    );

    await repository.save(metric, {
      deduplicationToken: metricInsertDeduplicationToken(MESSAGE_ID),
    });

    assert.deepEqual(
      (
        insertRequest as {
          clickhouse_settings: {
            insert_deduplication_token: string;
          };
        }
      ).clickhouse_settings,
      {
        insert_deduplication_token:
          "metrics:metric_workers:1788594646353-0",
      },
    );
  }

  {
    let savedToken: string | undefined;
    let evaluated = false;
    const processor = new MetricProcessor(
      {
        save: async (
          _event: MetricEvent,
          options: { deduplicationToken?: string },
        ) => {
          savedToken = options.deduplicationToken;
        },
      } as unknown as MetricRepository,
      {
        evaluate: async () => {
          evaluated = true;
        },
      } as unknown as MetricAlertEvaluator,
    );

    await processor.process(metric, context);
    assert.equal(
      savedToken,
      "metrics:metric_workers:1788594646353-0",
    );
    assert.equal(evaluated, true);
  }

  {
    let evaluationCalls = 0;
    const processor = new MetricProcessor(
      {
        save: async () => {
          throw new Error("ClickHouse unavailable");
        },
      } as unknown as MetricRepository,
      {
        evaluate: async () => {
          evaluationCalls += 1;
        },
      } as unknown as MetricAlertEvaluator,
    );
    const error = await expectStage(
      processor.process(metric, context),
      "clickhouse_save",
    );
    assert.equal(evaluationCalls, 0);
    assert.deepEqual(
      {
        messageId: error.diagnosticFields.messageId,
        service: error.diagnosticFields.service,
        name: error.diagnosticFields.name,
        type: error.diagnosticFields.type,
      },
      {
        messageId: MESSAGE_ID,
        service: metric.service,
        name: metric.name,
        type: metric.type,
      },
    );
  }

  {
    const processor = new MetricProcessor(
      { save: async () => undefined } as unknown as MetricRepository,
      {
        evaluate: async () => {
          throw new Error("Postgres unavailable");
        },
      } as unknown as MetricAlertEvaluator,
    );
    await expectStage(processor.process(metric, context), "alert_evaluation");
  }

  {
    let receivedContext: StreamProcessingContext | undefined;
    const redis = asRedis({
      xAck: async () => 1,
    });
    const handler = new StreamMessageHandler<MetricEvent>(
      redis,
      STREAMS.METRICS,
      GROUPS.METRIC_WORKERS,
      {
        process: async (_event, processingContext) => {
          receivedContext = processingContext;
        },
      },
      {
        consumerName: CONSUMER_NAME,
        requireSingleAcknowledgement: true,
      },
    );

    await handler.handle({
      id: MESSAGE_ID,
      message: { event: JSON.stringify(metric) },
    });
    assert.deepEqual(receivedContext, context);
  }

  {
    const handler = new StreamMessageHandler<MetricEvent>(
      asRedis({ xAck: async () => 0 }),
      STREAMS.METRICS,
      GROUPS.METRIC_WORKERS,
      { process: async () => undefined },
      { requireSingleAcknowledgement: true },
    );
    await expectStage(
      handler.handle({
        id: MESSAGE_ID,
        message: { event: JSON.stringify(metric) },
      }),
      "redis_ack",
    );
  }

  {
    const handler = new StreamMessageHandler<MetricEvent>(
      asRedis({}),
      STREAMS.METRICS,
      GROUPS.METRIC_WORKERS,
      { process: async () => undefined },
    );
    await expectStage(
      handler.handle({
        id: MESSAGE_ID,
        message: { event: "{invalid-json" },
      }),
      "payload_parse",
    );
  }

  console.log("metric worker reliability tests passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
