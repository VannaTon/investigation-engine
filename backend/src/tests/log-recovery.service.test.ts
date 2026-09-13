import assert from "node:assert/strict";
import type { RedisClientType } from "redis";
import { GROUPS, STREAMS } from "../constants/stream.js";
import type { LogEvent } from "../types/log-event.js";
import { StreamMessageHandler } from "../worker/handler/stream-message.handler.js";
import type { DlqPublisher } from "../worker/publisher/dlq.publisher.js";
import {
  LOG_MAX_PROCESSING_ATTEMPTS,
  LOG_RECOVERY_CLAIM_COUNT,
  LOG_RECOVERY_FAILURE_CODE,
  LOG_RECOVERY_INTERVAL_MS,
  LOG_RECOVERY_MIN_IDLE_MS,
  LogRecoveryService,
} from "../worker/recovery/log-recovery.service.js";
import { StreamProcessingError } from "../worker/stream-processing.error.js";

const MESSAGE_ID = "1788739200000-0";
const CONSUMER_NAME = "log-workers-recovery-test";
const event: LogEvent = {
  timestamp: "2026-09-07T08:00:00.000Z",
  service: "phase6d-recovery-test",
  level: "error",
  message: "controlled failure",
};

function asRedis(methods: Record<string, unknown>): RedisClientType {
  return methods as unknown as RedisClientType;
}

function asDlq(
  publishFields: (fields: Record<string, string>) => Promise<string>,
): DlqPublisher {
  return { publishFields } as unknown as DlqPublisher;
}

function claimedMessage() {
  return {
    id: MESSAGE_ID,
    message: { event: JSON.stringify(event) },
  };
}

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Promise did not settle in time.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function main(): Promise<void> {
  assert.equal(LOG_RECOVERY_MIN_IDLE_MS, 60_000);
  assert.equal(LOG_RECOVERY_INTERVAL_MS, 5_000);
  assert.equal(LOG_RECOVERY_CLAIM_COUNT, 1);
  assert.equal(LOG_MAX_PROCESSING_ATTEMPTS, 3);
  assert.equal(
    LOG_RECOVERY_FAILURE_CODE,
    "LOG_PROCESSING_ATTEMPTS_EXHAUSTED",
  );

  {
    const cursors: string[] = [];
    const claimOptions: unknown[] = [];
    let claimCall = 0;
    let acknowledged = 0;
    let dlqFields: Record<string, string> | undefined;
    const redis = asRedis({
      xAutoClaim: async (...args: unknown[]) => {
        cursors.push(String(args[4]));
        claimOptions.push(args[5]);
        claimCall += 1;

        if (claimCall === 1) {
          return {
            nextId: "1788739200000-0",
            messages: [],
            deletedMessages: [],
          };
        }

        return {
          nextId: "0-0",
          messages: [claimedMessage()],
          deletedMessages: [],
        };
      },
      xPendingRange: async () => [{ deliveriesCounter: 3 }],
      xAck: async () => {
        acknowledged += 1;
        return 1;
      },
    });
    const service = new LogRecoveryService(
      redis,
      {
        handle: async () => {
          throw new StreamProcessingError(
            "clickhouse_save",
            "ClickHouse unavailable",
          );
        },
      } as unknown as StreamMessageHandler<LogEvent>,
      asDlq(async (fields) => {
        dlqFields = fields;
        return "dlq-1";
      }),
      CONSUMER_NAME,
      { now: () => new Date("2026-09-07T08:01:00.000Z") },
    );

    await service.runSweep();

    assert.deepEqual(cursors, ["0-0", "1788739200000-0"]);
    assert.deepEqual(claimOptions, [{ COUNT: 1 }, { COUNT: 1 }]);
    assert.equal(acknowledged, 1);
    assert.deepEqual(dlqFields, {
      sourceStream: STREAMS.LOGS,
      sourceGroup: GROUPS.LOG_WORKERS,
      originalMessageId: MESSAGE_ID,
      recoveryConsumer: CONSUMER_NAME,
      deliveryCount: "3",
      attemptLimit: "3",
      failureCode: LOG_RECOVERY_FAILURE_CODE,
      failureStage: "clickhouse_save",
      failureMessage: "ClickHouse unavailable",
      originalFields: JSON.stringify(claimedMessage().message),
      failedAt: "2026-09-07T08:01:00.000Z",
    });
  }

  {
    let handlerCalls = 0;
    let dlqCalls = 0;
    const service = new LogRecoveryService(
      asRedis({
        xAutoClaim: async () => ({
          nextId: "0-0",
          messages: [claimedMessage()],
          deletedMessages: [],
        }),
        xPendingRange: async () => [{ deliveriesCounter: 2 }],
      }),
      {
        handle: async () => {
          handlerCalls += 1;
          throw new StreamProcessingError("clickhouse_save", "retry later");
        },
      } as unknown as StreamMessageHandler<LogEvent>,
      asDlq(async () => {
        dlqCalls += 1;
        return "dlq-unexpected";
      }),
      CONSUMER_NAME,
    );

    await service.runSweep();
    assert.equal(handlerCalls, 1);
    assert.equal(dlqCalls, 0);
  }

  {
    let processingCalls = 0;
    let acknowledged = 0;
    let dlqCalls = 0;
    const redis = asRedis({
      xAutoClaim: async () => ({
        nextId: "0-0",
        messages: [claimedMessage()],
        deletedMessages: [],
      }),
      xPendingRange: async () => [{ deliveriesCounter: 3 }],
      xAck: async () => {
        acknowledged += 1;
        return 1;
      },
    });
    const handler = new StreamMessageHandler<LogEvent>(
      redis,
      STREAMS.LOGS,
      GROUPS.LOG_WORKERS,
      {
        process: async () => {
          processingCalls += 1;
        },
      },
      {
        consumerName: CONSUMER_NAME,
        requireSingleAcknowledgement: true,
      },
    );
    const service = new LogRecoveryService(
      redis,
      handler,
      asDlq(async () => {
        dlqCalls += 1;
        return "dlq-unexpected";
      }),
      CONSUMER_NAME,
    );

    await service.runSweep();
    assert.equal(processingCalls, 1);
    assert.equal(acknowledged, 1);
    assert.equal(dlqCalls, 0);
  }

  {
    let processingCalls = 0;
    let acknowledged = 0;
    let dlqFields: Record<string, string> | undefined;
    const malformed = {
      id: MESSAGE_ID,
      message: { event: "{invalid-json" },
    };
    const redis = asRedis({
      xAutoClaim: async () => ({
        nextId: "0-0",
        messages: [malformed],
        deletedMessages: [],
      }),
      xPendingRange: async () => [{ deliveriesCounter: 3 }],
      xAck: async () => {
        acknowledged += 1;
        return 1;
      },
    });
    const handler = new StreamMessageHandler<LogEvent>(
      redis,
      STREAMS.LOGS,
      GROUPS.LOG_WORKERS,
      {
        process: async () => {
          processingCalls += 1;
        },
      },
      {
        consumerName: CONSUMER_NAME,
        requireSingleAcknowledgement: true,
      },
    );
    const service = new LogRecoveryService(
      redis,
      handler,
      asDlq(async (fields) => {
        dlqFields = fields;
        return "dlq-malformed";
      }),
      CONSUMER_NAME,
    );

    await service.runSweep();
    assert.equal(processingCalls, 0);
    assert.equal(acknowledged, 1);
    assert.equal(dlqFields?.failureStage, "payload_parse");
  }

  {
    let handlerCalls = 0;
    let acknowledged = 0;
    let dlqFields: Record<string, string> | undefined;
    const redis = asRedis({
      xAutoClaim: async () => ({
        nextId: "0-0",
        messages: [claimedMessage()],
        deletedMessages: [],
      }),
      xPendingRange: async () => [{ deliveriesCounter: 4 }],
      xAck: async () => {
        acknowledged += 1;
        return 1;
      },
    });
    const service = new LogRecoveryService(
      redis,
      {
        handle: async () => {
          handlerCalls += 1;
        },
      } as unknown as StreamMessageHandler<LogEvent>,
      asDlq(async (fields) => {
        dlqFields = fields;
        return "dlq-budget";
      }),
      CONSUMER_NAME,
    );

    await service.runSweep();
    assert.equal(handlerCalls, 0);
    assert.equal(acknowledged, 1);
    assert.equal(dlqFields?.failureStage, "attempt_budget_exhausted");
    assert.equal(dlqFields?.deliveryCount, "4");
  }

  {
    let acknowledged = 0;
    const service = new LogRecoveryService(
      asRedis({
        xAutoClaim: async () => ({
          nextId: "0-0",
          messages: [claimedMessage()],
          deletedMessages: [],
        }),
        xPendingRange: async () => [{ deliveriesCounter: 3 }],
        xAck: async () => {
          acknowledged += 1;
          return 1;
        },
      }),
      {
        handle: async () => {
          throw new StreamProcessingError("clickhouse_save", "final failure");
        },
      } as unknown as StreamMessageHandler<LogEvent>,
      asDlq(async () => {
        throw new Error("DLQ unavailable");
      }),
      CONSUMER_NAME,
    );

    await service.runSweep();
    assert.equal(acknowledged, 0);
  }

  {
    let claimCalls = 0;
    let firstSweepFinished: (() => void) | undefined;
    const firstSweep = new Promise<void>((resolve) => {
      firstSweepFinished = resolve;
    });
    const service = new LogRecoveryService(
      asRedis({
        xAutoClaim: async () => {
          claimCalls += 1;
          firstSweepFinished?.();
          return {
            nextId: "0-0",
            messages: [],
            deletedMessages: [],
          };
        },
      }),
      { handle: async () => undefined } as unknown as StreamMessageHandler<LogEvent>,
      asDlq(async () => "dlq-unexpected"),
      CONSUMER_NAME,
      { scanIntervalMs: 60_000 },
    );

    const running = service.start();
    await firstSweep;
    await Promise.resolve();
    service.stop();
    await settlesWithin(running, 100);
    assert.equal(claimCalls, 1);
  }

  console.log("log recovery service tests passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
