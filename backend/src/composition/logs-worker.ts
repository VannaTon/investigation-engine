import { redis } from "../config/redis.js";
import { GROUPS, STREAMS } from "../constants/stream.js";
import { LogStorageReadinessService } from "../services/log-storage-readiness.service.js";
import type { LogEvent } from "../types/log-event.js";
import { StreamConsumer } from "../worker/consumer/stream.consumer.js";
import { StreamMessageHandler } from "../worker/handler/stream-message.handler.js";
import { DlqPublisher } from "../worker/publisher/dlq.publisher.js";
import { LogRecoveryService } from "../worker/recovery/log-recovery.service.js";
import { resolveConsumerName } from "../worker/consumer/consumer-name.js";
import { processor } from "./log.js";

export const logConsumerName = resolveConsumerName(GROUPS.LOG_WORKERS);

const handler = new StreamMessageHandler<LogEvent>(
  redis,
  STREAMS.LOGS,
  GROUPS.LOG_WORKERS,
  processor,
  {
    consumerName: logConsumerName,
    requireSingleAcknowledgement: true,
  },
);

export const logWorker = new StreamConsumer(
  redis,
  logConsumerName,
  STREAMS.LOGS,
  GROUPS.LOG_WORKERS,
  handler,
);

export const logRecovery = new LogRecoveryService(
  redis,
  handler,
  new DlqPublisher(redis),
  logConsumerName,
);

export const logStorageReadiness = new LogStorageReadinessService();
