import type { RedisClientType } from "redis";
import { GROUPS, STREAMS } from "../../constants/stream.js";
import type { MetricEvent } from "../../types/metric-event.js";
import type { StreamMessageHandler } from "../handler/stream-message.handler.js";
import type { DlqPublisher } from "../publisher/dlq.publisher.js";
import {
  boundedErrorMessage,
  streamProcessingDiagnostics,
  streamProcessingStage,
  type StreamProcessingStage,
} from "../stream-processing.error.js";

export const METRIC_RECOVERY_MIN_IDLE_MS = 60_000;
export const METRIC_RECOVERY_INTERVAL_MS = 5_000;
export const METRIC_RECOVERY_CLAIM_COUNT = 1;
export const METRIC_MAX_PROCESSING_ATTEMPTS = 3;

const CLAIM_START = "0-0";
const FAILURE_CODE = "METRIC_PROCESSING_ATTEMPTS_EXHAUSTED";

type MetricStreamMessage = {
  id: string;
  message: Record<string, string>;
};

export interface MetricRecoveryOptions {
  minIdleTimeMs?: number;
  scanIntervalMs?: number;
  claimCount?: number;
  maxProcessingAttempts?: number;
  now?: () => Date;
  streamName?: string;
  groupName?: string;
  failureCode?: string;
  logPrefix?: string;
}

function metricIdentity(
  message: MetricStreamMessage,
): Record<string, string> {
  try {
    const parsed = JSON.parse(message.message.event ?? "") as unknown;

    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    const record = parsed as Record<string, unknown>;
    const identity: Record<string, string> = {};

    for (const key of ["service", "name", "type"] as const) {
      if (typeof record[key] === "string") {
        identity[key] = record[key];
      }
    }

    return identity;
  } catch {
    return {};
  }
}

export class MetricRecoveryService<TEvent = MetricEvent> {
  private readonly minIdleTimeMs: number;
  private readonly scanIntervalMs: number;
  private readonly claimCount: number;
  private readonly maxProcessingAttempts: number;
  private readonly now: () => Date;
  private readonly streamName: string;
  private readonly groupName: string;
  private readonly failureCode: string;
  private readonly logPrefix: string;
  private stopping = false;
  private cancelDelay: (() => void) | undefined;

  constructor(
    private readonly redis: RedisClientType,
    private readonly handler: StreamMessageHandler<TEvent>,
    private readonly dlqPublisher: DlqPublisher,
    private readonly consumerName: string,
    options: MetricRecoveryOptions = {},
  ) {
    this.minIdleTimeMs =
      options.minIdleTimeMs ?? METRIC_RECOVERY_MIN_IDLE_MS;
    this.scanIntervalMs =
      options.scanIntervalMs ?? METRIC_RECOVERY_INTERVAL_MS;
    this.claimCount = options.claimCount ?? METRIC_RECOVERY_CLAIM_COUNT;
    this.maxProcessingAttempts =
      options.maxProcessingAttempts ?? METRIC_MAX_PROCESSING_ATTEMPTS;
    this.now = options.now ?? (() => new Date());
    this.streamName = options.streamName ?? STREAMS.METRICS;
    this.groupName = options.groupName ?? GROUPS.METRIC_WORKERS;
    this.failureCode = options.failureCode ?? FAILURE_CODE;
    this.logPrefix = options.logPrefix ?? "metric";
  }

  stop(): void {
    this.stopping = true;
    this.cancelDelay?.();
  }

  async start(): Promise<void> {
    this.log("info", this.eventName("recovery_started"), {
      minIdleTimeMs: this.minIdleTimeMs,
      scanIntervalMs: this.scanIntervalMs,
      claimCount: this.claimCount,
      maxProcessingAttempts: this.maxProcessingAttempts,
    });

    while (!this.stopping) {
      try {
        await this.runSweep();
      } catch (error) {
        this.log("error", this.eventName("recovery_sweep_failed"), {
          error: boundedErrorMessage(error),
        });
      }

      if (!this.stopping) {
        await this.waitForNextSweep();
      }
    }

    this.log("info", this.eventName("recovery_stopped"));
  }

  async runSweep(): Promise<void> {
    let cursor = CLAIM_START;

    do {
      if (this.stopping) {
        return;
      }

      const result = await this.redis.xAutoClaim(
        this.streamName,
        this.groupName,
        this.consumerName,
        this.minIdleTimeMs,
        cursor,
        {
          COUNT: this.claimCount,
        },
      );

      cursor = String(result.nextId);

      for (const deletedMessageId of result.deletedMessages) {
        this.log("info", this.eventName("recovery_deleted_pending_entry"), {
          messageId: String(deletedMessageId),
        });
      }

      for (const message of result.messages) {
        if (message !== null) {
          await this.recoverMessage(message);
        }
      }
    } while (!this.stopping && cursor !== CLAIM_START);
  }

  private async recoverMessage(
    message: MetricStreamMessage,
  ): Promise<void> {
    const pending = await this.redis.xPendingRange(
      this.streamName,
      this.groupName,
      message.id,
      message.id,
      1,
    );
    const pendingEntry = pending[0];
    const identity = metricIdentity(message);

    if (pendingEntry === undefined) {
      this.log("info", this.eventName("recovery_pending_entry_missing"), {
        messageId: message.id,
        ...identity,
      });
      return;
    }

    const deliveryCount = pendingEntry.deliveriesCounter;

    if (deliveryCount > this.maxProcessingAttempts) {
      await this.moveToDlq(
        message,
        deliveryCount,
        "attempt_budget_exhausted",
        "Processing attempt budget was already exhausted before recovery.",
      );
      return;
    }

    try {
      await this.handler.handle(message);
      this.log("info", this.eventName("recovery_succeeded"), {
        messageId: message.id,
        deliveryCount,
        ...identity,
      });
    } catch (error) {
      const failureStage = streamProcessingStage(error);
      const messageText = boundedErrorMessage(error);
      const diagnostics = streamProcessingDiagnostics(error);

      if (deliveryCount < this.maxProcessingAttempts) {
        this.log("error", this.eventName("recovery_processing_failed"), {
          messageId: message.id,
          deliveryCount,
          failureStage,
          error: messageText,
          diagnostics,
          ...identity,
        });
        return;
      }

      await this.moveToDlq(
        message,
        deliveryCount,
        failureStage,
        messageText,
      );
    }
  }

  private async moveToDlq(
    message: MetricStreamMessage,
    deliveryCount: number,
    failureStage: StreamProcessingStage,
    messageText: string,
  ): Promise<void> {
    const identity = metricIdentity(message);
    let dlqMessageId: string;

    try {
      dlqMessageId = await this.dlqPublisher.publishFields({
        sourceStream: this.streamName,
        sourceGroup: this.groupName,
        originalMessageId: message.id,
        recoveryConsumer: this.consumerName,
        deliveryCount: String(deliveryCount),
        attemptLimit: String(this.maxProcessingAttempts),
        failureCode: this.failureCode,
        failureStage,
        failureMessage: messageText,
        originalFields: JSON.stringify(message.message),
        failedAt: this.now().toISOString(),
      });

      if (dlqMessageId.length === 0) {
        throw new Error("DLQ publisher returned an empty message ID.");
      }
    } catch (error) {
      this.log("error", this.eventName("dlq_publish_failed"), {
        messageId: message.id,
        deliveryCount,
        failureStage,
        error: boundedErrorMessage(error),
        ...identity,
      });
      return;
    }

    try {
      const acknowledged = await this.redis.xAck(
        this.streamName,
        this.groupName,
        message.id,
      );

      if (acknowledged !== 1) {
        this.log("error", this.eventName("dlq_acknowledgement_anomaly"), {
          messageId: message.id,
          dlqMessageId,
          deliveryCount,
          acknowledged,
          ...identity,
        });
        return;
      }

      this.log("info", this.eventName("moved_to_dlq"), {
        messageId: message.id,
        dlqMessageId,
        deliveryCount,
        failureStage,
        ...identity,
      });
    } catch (error) {
      this.log("error", this.eventName("dlq_acknowledgement_failed"), {
        messageId: message.id,
        dlqMessageId,
        deliveryCount,
        error: boundedErrorMessage(error),
        ...identity,
      });
    }
  }

  private waitForNextSweep(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.cancelDelay = undefined;
        resolve();
      }, this.scanIntervalMs);

      this.cancelDelay = () => {
        clearTimeout(timer);
        this.cancelDelay = undefined;
        resolve();
      };
    });
  }

  private eventName(suffix: string): string {
    return this.logPrefix + "_" + suffix;
  }

  private log(
    level: "info" | "error",
    event: string,
    fields: Record<string, unknown> = {},
  ): void {
    const entry = JSON.stringify({
      event,
      stream: this.streamName,
      group: this.groupName,
      consumer: this.consumerName,
      ...fields,
    });

    if (level === "error") {
      console.error(entry);
      return;
    }

    console.log(entry);
  }
}
