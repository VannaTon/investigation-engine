import assert from "node:assert/strict";
import type { RedisClientType } from "redis";
import { GROUPS, STREAMS } from "../constants/stream.js";
import type { Span } from "../types/span.js";
import { StreamConsumer } from "../worker/consumer/stream.consumer.js";
import { StreamMessageHandler } from "../worker/handler/stream-message.handler.js";
import type { Processor } from "../worker/processor/processor.js";
import type { DlqPublisher } from "../worker/publisher/dlq.publisher.js";
import {
  SPAN_MAX_PROCESSING_ATTEMPTS,
  SPAN_RECOVERY_CLAIM_COUNT,
  SPAN_RECOVERY_INTERVAL_MS,
  SPAN_RECOVERY_MIN_IDLE_MS,
  SpanRecoveryService,
} from "../worker/recovery/span-recovery.service.js";

const CONSUMER_NAME = "span-workers-test";
const MESSAGE_ID = "1788396857684-0";
const FIXED_NOW = new Date("2026-09-03T02:00:00.000Z");
const span = {
  traceId: "00000000000000000000000000000001",
  spanId: "0000000000000001",
} as unknown as Span;
const message = {
  id: MESSAGE_ID,
  message: {
    event: JSON.stringify(span),
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
  process: Processor<Span>["process"],
): StreamMessageHandler<Span> {
  return new StreamMessageHandler<Span>(
    redis,
    STREAMS.SPANS,
    GROUPS.SPAN_WORKERS,
    { process },
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
  assert.equal(SPAN_RECOVERY_MIN_IDLE_MS, 60_000);
  assert.equal(SPAN_RECOVERY_INTERVAL_MS, 5_000);
  assert.equal(SPAN_RECOVERY_CLAIM_COUNT, 1);
  assert.equal(SPAN_MAX_PROCESSING_ATTEMPTS, 3);

  {
    const claimCalls: unknown[][] = [];
    let claimIndex = 0;
    const redis = asRedis({
      xAutoClaim: async (...args: unknown[]) => {
        claimCalls.push(args);
        claimIndex += 1;

        if (claimIndex === 1) {
          return {
            nextId: "123-0",
            messages: [],
            deletedMessages: ["99-0"],
          };
        }

        return {
          nextId: "0-0",
          messages: [],
          deletedMessages: [],
        };
      },
    });
    const handler = {
      handle: async () => undefined,
    } as unknown as StreamMessageHandler<Span>;
    const service = new SpanRecoveryService(
      redis,
      handler,
      asDlq(async () => "dlq-1"),
      CONSUMER_NAME,
    );

    await service.runSweep();

    assert.deepEqual(claimCalls, [
      [
        STREAMS.SPANS,
        GROUPS.SPAN_WORKERS,
        CONSUMER_NAME,
        60_000,
        "0-0",
        { COUNT: 1 },
      ],
      [
        STREAMS.SPANS,
        GROUPS.SPAN_WORKERS,
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
      throw new Error("ClickHouse unavailable");
    });
    const dlq = asDlq(async (fields) => {
      operations.push("dlq");
      dlqRecords.push(fields);
      return "1788397000000-0";
    });
    const service = new SpanRecoveryService(
      redis,
      handler,
      dlq,
      CONSUMER_NAME,
      { now: () => FIXED_NOW },
    );

    await assert.rejects(handler.handle(message), /ClickHouse unavailable/);
    assert.equal(processorCalls, 1);

    await service.runSweep();
    assert.equal(processorCalls, 2);
    assert.deepEqual(operations, []);

    await service.runSweep();
    assert.equal(processorCalls, 3);
    assert.deepEqual(operations, ["dlq", "ack"]);
    assert.deepEqual(dlqRecords, [
      {
        sourceStream: STREAMS.SPANS,
        sourceGroup: GROUPS.SPAN_WORKERS,
        originalMessageId: MESSAGE_ID,
        recoveryConsumer: CONSUMER_NAME,
        deliveryCount: "3",
        attemptLimit: "3",
        failureCode: "SPAN_PROCESSING_ATTEMPTS_EXHAUSTED",
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
    const handler = handlerWith(redis, async () => {
      processorCalls += 1;
      throw new Error("ClickHouse unavailable");
    });
    const dlq = asDlq(async () => {
      publishCalls += 1;

      if (publishCalls === 1) {
        throw new Error("Redis DLQ unavailable");
      }

      return "1788397000001-0";
    });
    const service = new SpanRecoveryService(
      redis,
      handler,
      dlq,
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
    const malformedMessage = {
      id: MESSAGE_ID,
      message: {
        event: "{not-json",
        extra: "preserve-me",
      },
    };
    let processorCalls = 0;
    let acknowledgementCalls = 0;
    let dlqRecord: Record<string, string> | undefined;
    const redis = asRedis({
      xAutoClaim: async () => ({
        nextId: "0-0",
        messages: [malformedMessage],
        deletedMessages: [],
      }),
      xPendingRange: async () => [
        {
          id: MESSAGE_ID,
          consumer: CONSUMER_NAME,
          millisecondsSinceLastDelivery: 0,
          deliveriesCounter: 3,
        },
      ],
      xAck: async () => {
        acknowledgementCalls += 1;
        return 1;
      },
    });
    const handler = handlerWith(redis, async () => {
      processorCalls += 1;
    });
    const service = new SpanRecoveryService(
      redis,
      handler,
      asDlq(async (fields) => {
        dlqRecord = fields;
        return "1788397000002-0";
      }),
      CONSUMER_NAME,
      { now: () => FIXED_NOW },
    );

    await service.runSweep();

    assert.equal(processorCalls, 0);
    assert.equal(acknowledgementCalls, 1);
    assert.ok(dlqRecord);
    assert.equal(
      dlqRecord.failureCode,
      "SPAN_PROCESSING_ATTEMPTS_EXHAUSTED",
    );
    assert.ok(dlqRecord.failureMessage);
    assert.equal(
      dlqRecord.originalFields,
      JSON.stringify(malformedMessage.message),
    );
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
    const service = new SpanRecoveryService(
      redis,
      {
        handle: async () => undefined,
      } as unknown as StreamMessageHandler<Span>,
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

  {
    let releaseRead: ((value: null) => void) | undefined;
    let handlerCalls = 0;
    const blockedRead = new Promise<null>((resolve) => {
      releaseRead = resolve;
    });
    const redis = asRedis({
      xReadGroup: async () => blockedRead,
    });
    const consumer = new StreamConsumer(
      redis,
      CONSUMER_NAME,
      STREAMS.SPANS,
      GROUPS.SPAN_WORKERS,
      {
        handle: async () => {
          handlerCalls += 1;
        },
      } as unknown as StreamMessageHandler<Span>,
    );

    const running = consumer.start();
    consumer.stop();
    releaseRead?.(null);
    await settlesWithin(running, 100);
    assert.equal(handlerCalls, 0);
  }

  console.log("span recovery service tests passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
