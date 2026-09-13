import assert from "node:assert/strict";
import type { RedisClientType } from "redis";
import { GROUPS, STREAMS } from "../constants/stream.js";
import type { MetricEvent } from "../types/metric-event.js";
import { StreamMessageHandler } from "../worker/handler/stream-message.handler.js";
import type { Processor } from "../worker/processor/processor.js";
import type { DlqPublisher } from "../worker/publisher/dlq.publisher.js";
import {
  METRIC_MAX_PROCESSING_ATTEMPTS,
  METRIC_RECOVERY_CLAIM_COUNT,
  METRIC_RECOVERY_INTERVAL_MS,
  METRIC_RECOVERY_MIN_IDLE_MS,
  MetricRecoveryService,
} from "../worker/recovery/metric-recovery.service.js";
import { StreamProcessingError } from "../worker/stream-processing.error.js";

const CONSUMER_NAME = "metric_workers-test";
const MESSAGE_ID = "1788594646353-0";
const FIXED_NOW = new Date("2026-09-05T08:00:00.000Z");
const metric: MetricEvent = {
  timestamp: "2026-09-05T07:50:46.336Z",
  service: "phase5e-test",
  name: "nodejs.eventloop.time",
  type: "counter",
  value: 0.08,
};
const message = {
  id: MESSAGE_ID,
  message: {
    event: JSON.stringify(metric),
  },
};

function asRedis(methods: Record<string, unknown>): RedisClientType {
  return methods as unknown as RedisClientType;
}

function asDlq(
  publishFields: (fields: Record<string, string>) => Promise<string>,
): DlqPublisher {
  return { publishFields } as unknown as DlqPublisher;
}

function handlerWith(
  redis: RedisClientType,
  process: Processor<MetricEvent>["process"],
): StreamMessageHandler<MetricEvent> {
  return new StreamMessageHandler<MetricEvent>(
    redis,
    STREAMS.METRICS,
    GROUPS.METRIC_WORKERS,
    { process },
    {
      consumerName: CONSUMER_NAME,
      requireSingleAcknowledgement: true,
    },
  );
}

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Promise did not settle before timeout.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function main(): Promise<void> {
  assert.equal(METRIC_RECOVERY_MIN_IDLE_MS, 60_000);
  assert.equal(METRIC_RECOVERY_INTERVAL_MS, 5_000);
  assert.equal(METRIC_RECOVERY_CLAIM_COUNT, 1);
  assert.equal(METRIC_MAX_PROCESSING_ATTEMPTS, 3);

  {
    const claimCalls: unknown[][] = [];
    let claimIndex = 0;
    const redis = asRedis({
      xAutoClaim: async (...args: unknown[]) => {
        claimCalls.push(args);
        claimIndex += 1;

        return claimIndex === 1
          ? {
              nextId: "123-0",
              messages: [],
              deletedMessages: ["99-0"],
            }
          : {
              nextId: "0-0",
              messages: [],
              deletedMessages: [],
            };
      },
    });
    const service = new MetricRecoveryService(
      redis,
      { handle: async () => undefined } as unknown as StreamMessageHandler<MetricEvent>,
      asDlq(async () => "dlq-1"),
      CONSUMER_NAME,
    );

    await service.runSweep();

    assert.deepEqual(claimCalls, [
      [
        STREAMS.METRICS,
        GROUPS.METRIC_WORKERS,
        CONSUMER_NAME,
        60_000,
        "0-0",
        { COUNT: 1 },
      ],
      [
        STREAMS.METRICS,
        GROUPS.METRIC_WORKERS,
        CONSUMER_NAME,
        60_000,
        "123-0",
        { COUNT: 1 },
      ],
    ]);
  }

  {
    let processorCalls = 0;
    const deliveryCounts = [2, 3];
    const operations: string[] = [];
    const dlqRecords: Array<Record<string, string>> = [];
    const redis = asRedis({
      xAutoClaim: async () => ({
        nextId: "0-0",
        messages: [message],
        deletedMessages: [],
      }),
      xPendingRange: async () => [
        {
          id: MESSAGE_ID,
          consumer: CONSUMER_NAME,
          millisecondsSinceLastDelivery: 0,
          deliveriesCounter: deliveryCounts.shift(),
        },
      ],
      xAck: async () => {
        operations.push("ack");
        return 1;
      },
    });
    const handler = handlerWith(redis, async () => {
      processorCalls += 1;
      throw new StreamProcessingError(
        "clickhouse_save",
        "ClickHouse unavailable",
      );
    });
    const service = new MetricRecoveryService(
      redis,
      handler,
      asDlq(async (fields) => {
        operations.push("dlq");
        dlqRecords.push(fields);
        return "1788595000000-0";
      }),
      CONSUMER_NAME,
      { now: () => FIXED_NOW },
    );

    await service.runSweep();
    assert.equal(processorCalls, 1);
    assert.deepEqual(operations, []);

    await service.runSweep();
    assert.equal(processorCalls, 2);
    assert.deepEqual(operations, ["dlq", "ack"]);
    assert.deepEqual(dlqRecords, [
      {
        sourceStream: STREAMS.METRICS,
        sourceGroup: GROUPS.METRIC_WORKERS,
        originalMessageId: MESSAGE_ID,
        recoveryConsumer: CONSUMER_NAME,
        deliveryCount: "3",
        attemptLimit: "3",
        failureCode: "METRIC_PROCESSING_ATTEMPTS_EXHAUSTED",
        failureStage: "clickhouse_save",
        failureMessage: "ClickHouse unavailable",
        originalFields: JSON.stringify(message.message),
        failedAt: FIXED_NOW.toISOString(),
      },
    ]);
  }

  {
    let processorCalls = 0;
    let publishCalls = 0;
    let acknowledgementCalls = 0;
    const deliveryCounts = [3, 4];
    const redis = asRedis({
      xAutoClaim: async () => ({
        nextId: "0-0",
        messages: [message],
        deletedMessages: [],
      }),
      xPendingRange: async () => [
        {
          id: MESSAGE_ID,
          consumer: CONSUMER_NAME,
          millisecondsSinceLastDelivery: 0,
          deliveriesCounter: deliveryCounts.shift(),
        },
      ],
      xAck: async () => {
        acknowledgementCalls += 1;
        return 1;
      },
    });
    const service = new MetricRecoveryService(
      redis,
      handlerWith(redis, async () => {
        processorCalls += 1;
        throw new StreamProcessingError(
          "alert_evaluation",
          "Postgres unavailable",
        );
      }),
      asDlq(async () => {
        publishCalls += 1;
        if (publishCalls === 1) {
          throw new Error("Redis DLQ unavailable");
        }
        return "1788595000001-0";
      }),
      CONSUMER_NAME,
    );

    await service.runSweep();
    assert.equal(processorCalls, 1);
    assert.equal(publishCalls, 1);
    assert.equal(acknowledgementCalls, 0);

    await service.runSweep();
    assert.equal(processorCalls, 1);
    assert.equal(publishCalls, 2);
    assert.equal(acknowledgementCalls, 1);
  }

  {
    let claimCalls = 0;
    let firstSweepFinished: (() => void) | undefined;
    const firstSweep = new Promise<void>((resolve) => {
      firstSweepFinished = resolve;
    });
    const redis = asRedis({
      xAutoClaim: async () => {
        claimCalls += 1;
        firstSweepFinished?.();
        return {
          nextId: "0-0",
          messages: [],
          deletedMessages: [],
        };
      },
    });
    const service = new MetricRecoveryService(
      redis,
      { handle: async () => undefined } as unknown as StreamMessageHandler<MetricEvent>,
      asDlq(async () => "dlq-1"),
      CONSUMER_NAME,
    );

    const running = service.start();
    await firstSweep;
    await Promise.resolve();
    service.stop();
    await settlesWithin(running, 100);
    assert.equal(claimCalls, 1);
  }

  console.log("metric recovery service tests passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
