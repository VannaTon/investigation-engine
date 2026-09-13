import assert from "node:assert/strict";
import type { RedisClientType } from "redis";
import { isLogRecoveryEnabled } from "../config/log-recovery.js";
import { GROUPS, STREAMS } from "../constants/stream.js";
import { ErrorGroupRepository } from "../repository/error-group.repository.js";
import { LogRepository } from "../repository/log.repository.js";
import {
  LOG_REQUIRED_DEDUPLICATION_WINDOW,
  LogStorageReadinessService,
  parseLogNonReplicatedDeduplicationWindow,
} from "../services/log-storage-readiness.service.js";
import type { LogEvent } from "../types/log-event.js";
import { StreamMessageHandler } from "../worker/handler/stream-message.handler.js";
import {
  LogProcessor,
  logInsertDeduplicationToken,
} from "../worker/processor/log.processor.js";
import type { StreamProcessingContext } from "../worker/processor/processor.js";
import { StreamProcessingError } from "../worker/stream-processing.error.js";

const MESSAGE_ID = "1788739200000-0";
const CONSUMER_NAME = "log-workers-test";
const logEvent: LogEvent = {
  timestamp: "2026-09-07T08:00:00.000Z",
  service: "phase6d-test",
  level: "error",
  message: "Database request failed for order 12345",
  traceId: "0123456789abcdef0123456789abcdef",
};
const context: StreamProcessingContext = {
  messageId: MESSAGE_ID,
  streamName: STREAMS.LOGS,
  groupName: GROUPS.LOG_WORKERS,
  consumerName: CONSUMER_NAME,
};

function asRedis(methods: Record<string, unknown>): RedisClientType {
  return methods as unknown as RedisClientType;
}

function readinessWith(
  engineFull: string,
  engine = "MergeTree",
  ledgerExists = true,
): LogStorageReadinessService {
  return new LogStorageReadinessService(
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
    LOG_REQUIRED_DEDUPLICATION_WINDOW,
    {
      query: async () => ({ rows: [{ exists: ledgerExists }] }),
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
  assert.equal(LOG_REQUIRED_DEDUPLICATION_WINDOW, 10_000);
  assert.equal(
    parseLogNonReplicatedDeduplicationWindow(
      "MergeTree ORDER BY (timestamp, service) SETTINGS " +
        "index_granularity = 8192, non_replicated_deduplication_window = 10000",
    ),
    10_000,
  );
  assert.equal(
    parseLogNonReplicatedDeduplicationWindow(
      "MergeTree ORDER BY timestamp SETTINGS index_granularity = 8192",
    ),
    undefined,
  );

  assert.equal(isLogRecoveryEnabled({}), false);
  assert.equal(isLogRecoveryEnabled({ LOG_RECOVERY_ENABLED: "false" }), false);
  assert.equal(isLogRecoveryEnabled({ LOG_RECOVERY_ENABLED: "true" }), true);

  assert.deepEqual(
    await readinessWith(
      "MergeTree ORDER BY timestamp SETTINGS " +
        "non_replicated_deduplication_window = 10000",
    ).assertReady(),
    {
      engine: "MergeTree",
      configuredWindow: 10_000,
      requiredWindow: 10_000,
      occurrenceLedgerTable: "error_group_occurrences",
    },
  );
  await assert.rejects(
    readinessWith(
      "MergeTree ORDER BY timestamp SETTINGS " +
        "non_replicated_deduplication_window = 9999",
    ).assertReady(),
    /requires non_replicated_deduplication_window >= 10000; found 9999/,
  );
  await assert.rejects(
    readinessWith(
      "ReplicatedMergeTree('\/clickhouse\/tables\/logs', '{replica}') " +
        "ORDER BY timestamp SETTINGS " +
        "non_replicated_deduplication_window = 10000",
      "ReplicatedMergeTree",
    ).assertReady(),
    /requires the non-replicated MergeTree logs table/,
  );
  await assert.rejects(
    readinessWith(
      "MergeTree ORDER BY timestamp SETTINGS " +
        "non_replicated_deduplication_window = 10000",
      "MergeTree",
      false,
    ).assertReady(),
    /requires the public.error_group_occurrences table/,
  );

  {
    let insertRequest: unknown;
    const repository = new LogRepository(
      {
        insert: async (request: unknown) => {
          insertRequest = request;
          return {} as never;
        },
      } as never,
    );

    await repository.save(logEvent, {
      deduplicationToken: logInsertDeduplicationToken(MESSAGE_ID),
    });

    assert.deepEqual(
      (
        insertRequest as {
          clickhouse_settings: { insert_deduplication_token: string };
        }
      ).clickhouse_settings,
      {
        insert_deduplication_token: "logs:log-workers:1788739200000-0",
      },
    );
  }

  {
    const stages: string[] = [];
    let savedToken: string | undefined;
    let occurrenceIdentity: unknown;
    const event = { ...logEvent };
    const processor = new LogProcessor(
      {
        save: async (
          _event: LogEvent,
          options: { deduplicationToken?: string },
        ) => {
          stages.push("clickhouse");
          savedToken = options.deduplicationToken;
        },
      } as unknown as LogRepository,
      {
        upsertOnce: async (
          storedEvent: LogEvent,
          _normalized: string,
          identity: unknown,
        ) => {
          stages.push("postgres");
          occurrenceIdentity = identity;
          assert.ok(storedEvent.fingerprint);
          return "recorded" as const;
        },
      } as unknown as ErrorGroupRepository,
      { replayProtectionEnabled: true },
    );

    await processor.process(event, context);

    assert.deepEqual(stages, ["clickhouse", "postgres"]);
    assert.equal(savedToken, "logs:log-workers:1788739200000-0");
    assert.deepEqual(occurrenceIdentity, {
      sourceStream: STREAMS.LOGS,
      sourceGroup: GROUPS.LOG_WORKERS,
      messageId: MESSAGE_ID,
    });
  }

  {
    let occurrenceCalls = 0;
    const processor = new LogProcessor(
      {
        save: async () => {
          throw new Error("ClickHouse unavailable");
        },
      } as unknown as LogRepository,
      {
        upsertOnce: async () => {
          occurrenceCalls += 1;
          return "recorded" as const;
        },
      } as unknown as ErrorGroupRepository,
      { replayProtectionEnabled: true },
    );

    const error = await expectStage(
      processor.process({ ...logEvent }, context),
      "clickhouse_save",
    );
    assert.equal(occurrenceCalls, 0);
    assert.equal(error.diagnosticFields.messageId, MESSAGE_ID);
    assert.equal(error.diagnosticFields.service, logEvent.service);
  }

  {
    const processor = new LogProcessor(
      { save: async () => undefined } as unknown as LogRepository,
      {
        upsertOnce: async () => {
          throw new Error("Postgres unavailable");
        },
      } as unknown as ErrorGroupRepository,
      { replayProtectionEnabled: true },
    );

    await expectStage(
      processor.process({ ...logEvent }, context),
      "error_group_upsert",
    );
  }

  {
    let occurrenceCalls = 0;
    const processor = new LogProcessor(
      { save: async () => undefined } as unknown as LogRepository,
      {
        upsertOnce: async () => {
          occurrenceCalls += 1;
          return "recorded" as const;
        },
      } as unknown as ErrorGroupRepository,
    );

    await processor.process(
      { ...logEvent, level: "info" },
      context,
    );
    assert.equal(occurrenceCalls, 0);
  }

  {
    let legacyUpsertCalls = 0;
    let ledgerUpsertCalls = 0;
    const processor = new LogProcessor(
      { save: async () => undefined } as unknown as LogRepository,
      {
        upsert: async () => {
          legacyUpsertCalls += 1;
        },
        upsertOnce: async () => {
          ledgerUpsertCalls += 1;
          return "recorded" as const;
        },
      } as unknown as ErrorGroupRepository,
    );

    await processor.process({ ...logEvent }, context);
    assert.equal(legacyUpsertCalls, 1);
    assert.equal(ledgerUpsertCalls, 0);
  }

  {
    const statements: string[] = [];
    let released = 0;
    const repository = new ErrorGroupRepository(
      {
        connect: async () =>
          ({
            query: async (sql: string) => {
              const normalized = sql.trim().replace(/\s+/g, " ");
              statements.push(normalized);
              if (normalized.startsWith("INSERT INTO error_group_occurrences")) {
                return { rows: [{ fingerprint: "fingerprint-a" }] };
              }
              return { rows: [] };
            },
            release: () => {
              released += 1;
            },
          }) as never,
        query: async () => ({ rows: [] }) as never,
      } as never,
    );

    const result = await repository.upsertOnce(
      { ...logEvent, fingerprint: "fingerprint-a" },
      "normalized message",
      {
        sourceStream: STREAMS.LOGS,
        sourceGroup: GROUPS.LOG_WORKERS,
        messageId: MESSAGE_ID,
      },
    );

    assert.equal(result, "recorded");
    assert.equal(statements[0], "BEGIN");
    assert.match(statements[1] ?? "", /^INSERT INTO error_group_occurrences/);
    assert.match(statements[2] ?? "", /^INSERT INTO error_groups/);
    assert.equal(statements[3], "COMMIT");
    assert.equal(released, 1);
  }

  {
    const statements: string[] = [];
    const repository = new ErrorGroupRepository(
      {
        connect: async () =>
          ({
            query: async (sql: string) => {
              const normalized = sql.trim().replace(/\s+/g, " ");
              statements.push(normalized);
              if (normalized.startsWith("INSERT INTO error_group_occurrences")) {
                return { rows: [] };
              }
              if (normalized.startsWith("SELECT fingerprint")) {
                return { rows: [{ fingerprint: "fingerprint-a" }] };
              }
              return { rows: [] };
            },
            release: () => undefined,
          }) as never,
        query: async () => ({ rows: [] }) as never,
      } as never,
    );

    const result = await repository.upsertOnce(
      { ...logEvent, fingerprint: "fingerprint-a" },
      "normalized message",
      {
        sourceStream: STREAMS.LOGS,
        sourceGroup: GROUPS.LOG_WORKERS,
        messageId: MESSAGE_ID,
      },
    );

    assert.equal(result, "duplicate");
    assert.equal(
      statements.some((statement) => statement.startsWith("INSERT INTO error_groups")),
      false,
    );
    assert.equal(statements.at(-1), "COMMIT");
  }

  {
    const statements: string[] = [];
    const repository = new ErrorGroupRepository(
      {
        connect: async () =>
          ({
            query: async (sql: string) => {
              const normalized = sql.trim().replace(/\s+/g, " ");
              statements.push(normalized);
              if (normalized.startsWith("INSERT INTO error_group_occurrences")) {
                return { rows: [] };
              }
              if (normalized.startsWith("SELECT fingerprint")) {
                return { rows: [{ fingerprint: "different-fingerprint" }] };
              }
              return { rows: [] };
            },
            release: () => undefined,
          }) as never,
        query: async () => ({ rows: [] }) as never,
      } as never,
    );

    await assert.rejects(
      repository.upsertOnce(
        { ...logEvent, fingerprint: "fingerprint-a" },
        "normalized message",
        {
          sourceStream: STREAMS.LOGS,
          sourceGroup: GROUPS.LOG_WORKERS,
          messageId: MESSAGE_ID,
        },
      ),
      /already recorded with a different fingerprint/,
    );
    assert.equal(statements.at(-1), "ROLLBACK");
  }

  {
    const handler = new StreamMessageHandler<LogEvent>(
      asRedis({ xAck: async () => 0 }),
      STREAMS.LOGS,
      GROUPS.LOG_WORKERS,
      { process: async () => undefined },
      {
        consumerName: CONSUMER_NAME,
        requireSingleAcknowledgement: true,
      },
    );

    await expectStage(
      handler.handle({
        id: MESSAGE_ID,
        message: { event: JSON.stringify(logEvent) },
      }),
      "redis_ack",
    );
  }

  console.log("log worker reliability tests passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
