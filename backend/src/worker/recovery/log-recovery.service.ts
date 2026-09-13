import type { RedisClientType } from "redis";
import { GROUPS, STREAMS } from "../../constants/stream.js";
import type { LogEvent } from "../../types/log-event.js";
import type { StreamMessageHandler } from "../handler/stream-message.handler.js";
import type { DlqPublisher } from "../publisher/dlq.publisher.js";
import { MetricRecoveryService } from "./metric-recovery.service.js";

export const LOG_RECOVERY_MIN_IDLE_MS = 60_000;
export const LOG_RECOVERY_INTERVAL_MS = 5_000;
export const LOG_RECOVERY_CLAIM_COUNT = 1;
export const LOG_MAX_PROCESSING_ATTEMPTS = 3;
export const LOG_RECOVERY_FAILURE_CODE =
  "LOG_PROCESSING_ATTEMPTS_EXHAUSTED";

export interface LogRecoveryOptions {
  minIdleTimeMs?: number;
  scanIntervalMs?: number;
  claimCount?: number;
  maxProcessingAttempts?: number;
  now?: () => Date;
}

export class LogRecoveryService extends MetricRecoveryService<LogEvent> {
  constructor(
    redis: RedisClientType,
    handler: StreamMessageHandler<LogEvent>,
    dlqPublisher: DlqPublisher,
    consumerName: string,
    options: LogRecoveryOptions = {},
  ) {
    super(redis, handler, dlqPublisher, consumerName, {
      ...options,
      minIdleTimeMs:
        options.minIdleTimeMs ?? LOG_RECOVERY_MIN_IDLE_MS,
      scanIntervalMs:
        options.scanIntervalMs ?? LOG_RECOVERY_INTERVAL_MS,
      claimCount: options.claimCount ?? LOG_RECOVERY_CLAIM_COUNT,
      maxProcessingAttempts:
        options.maxProcessingAttempts ?? LOG_MAX_PROCESSING_ATTEMPTS,
      streamName: STREAMS.LOGS,
      groupName: GROUPS.LOG_WORKERS,
      failureCode: LOG_RECOVERY_FAILURE_CODE,
      logPrefix: "log",
    });
  }
}
