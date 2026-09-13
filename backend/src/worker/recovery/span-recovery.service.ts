import type { RedisClientType } from "redis";
import { GROUPS, STREAMS } from "../../constants/stream.js";
import type { Span } from "../../types/span.js";
import type { StreamMessageHandler } from "../handler/stream-message.handler.js";
import type { DlqPublisher } from "../publisher/dlq.publisher.js";

export const SPAN_RECOVERY_MIN_IDLE_MS = 60_000;
export const SPAN_RECOVERY_INTERVAL_MS = 5_000;
export const SPAN_RECOVERY_CLAIM_COUNT = 1;
export const SPAN_MAX_PROCESSING_ATTEMPTS = 3;

const CLAIM_START = "0-0";
const FAILURE_CODE = "SPAN_PROCESSING_ATTEMPTS_EXHAUSTED";
const MAX_FAILURE_MESSAGE_LENGTH = 1_024;

type SpanStreamMessage = {
  id: string;
  message: Record<string, string>;
};

export interface SpanRecoveryOptions {
  minIdleTimeMs?: number;
  scanIntervalMs?: number;
  claimCount?: number;
  maxProcessingAttempts?: number;
  now?: () => Date;
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

export class SpanRecoveryService {
  private readonly minIdleTimeMs: number;
  private readonly scanIntervalMs: number;
  private readonly claimCount: number;
  private readonly maxProcessingAttempts: number;
  private readonly now: () => Date;
  private stopping = false;
  private cancelDelay: (() => void) | undefined;

  constructor(
    private readonly redis: RedisClientType,
    private readonly handler: StreamMessageHandler<Span>,
    private readonly dlqPublisher: DlqPublisher,
    private readonly consumerName: string,
    options: SpanRecoveryOptions = {},
  ) {
    this.minIdleTimeMs =
      options.minIdleTimeMs ?? SPAN_RECOVERY_MIN_IDLE_MS;
    this.scanIntervalMs =
      options.scanIntervalMs ?? SPAN_RECOVERY_INTERVAL_MS;
    this.claimCount = options.claimCount ?? SPAN_RECOVERY_CLAIM_COUNT;
    this.maxProcessingAttempts =
      options.maxProcessingAttempts ?? SPAN_MAX_PROCESSING_ATTEMPTS;
    this.now = options.now ?? (() => new Date());
  }

  stop(): void {
    this.stopping = true;
    this.cancelDelay?.();
  }

  async start(): Promise<void> {
    this.log("info", "span_recovery_started", {
      minIdleTimeMs: this.minIdleTimeMs,
      scanIntervalMs: this.scanIntervalMs,
      claimCount: this.claimCount,
      maxProcessingAttempts: this.maxProcessingAttempts,
    });

    while (!this.stopping) {
      try {
        await this.runSweep();
      } catch (error) {
        this.log("error", "span_recovery_sweep_failed", {
          error: failureMessage(error),
        });
      }

      if (!this.stopping) {
        await this.waitForNextSweep();
      }
    }

    this.log("info", "span_recovery_stopped");
  }

  async runSweep(): Promise<void> {
    let cursor = CLAIM_START;

    do {
      if (this.stopping) {
        return;
      }

      const result = await this.redis.xAutoClaim(
        STREAMS.SPANS,
        GROUPS.SPAN_WORKERS,
        this.consumerName,
        this.minIdleTimeMs,
        cursor,
        {
          COUNT: this.claimCount,
        },
      );

      cursor = String(result.nextId);

      for (const deletedMessageId of result.deletedMessages) {
        this.log("info", "span_recovery_deleted_pending_entry", {
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

  private async recoverMessage(message: SpanStreamMessage): Promise<void> {
    const pending = await this.redis.xPendingRange(
      STREAMS.SPANS,
      GROUPS.SPAN_WORKERS,
      message.id,
      message.id,
      1,
    );
    const pendingEntry = pending[0];

    if (pendingEntry === undefined) {
      this.log("info", "span_recovery_pending_entry_missing", {
        messageId: message.id,
      });
      return;
    }

    const deliveryCount = pendingEntry.deliveriesCounter;

    if (deliveryCount > this.maxProcessingAttempts) {
      await this.moveToDlq(
        message,
        deliveryCount,
        "Processing attempt budget was already exhausted before recovery.",
      );
      return;
    }

    try {
      await this.handler.handle(message);
      this.log("info", "span_recovery_succeeded", {
        messageId: message.id,
        deliveryCount,
      });
    } catch (error) {
      const messageText = failureMessage(error);

      if (deliveryCount < this.maxProcessingAttempts) {
        this.log("error", "span_recovery_processing_failed", {
          messageId: message.id,
          deliveryCount,
          error: messageText,
        });
        return;
      }

      await this.moveToDlq(message, deliveryCount, messageText);
    }
  }

  private async moveToDlq(
    message: SpanStreamMessage,
    deliveryCount: number,
    messageText: string,
  ): Promise<void> {
    let dlqMessageId: string;

    try {
      dlqMessageId = await this.dlqPublisher.publishFields({
        sourceStream: STREAMS.SPANS,
        sourceGroup: GROUPS.SPAN_WORKERS,
        originalMessageId: message.id,
        recoveryConsumer: this.consumerName,
        deliveryCount: String(deliveryCount),
        attemptLimit: String(this.maxProcessingAttempts),
        failureCode: FAILURE_CODE,
        failureMessage: messageText.slice(0, MAX_FAILURE_MESSAGE_LENGTH),
        originalFields: JSON.stringify(message.message),
        failedAt: this.now().toISOString(),
      });

      if (dlqMessageId.length === 0) {
        throw new Error("DLQ publisher returned an empty message ID.");
      }
    } catch (error) {
      this.log("error", "span_dlq_publish_failed", {
        messageId: message.id,
        deliveryCount,
        error: failureMessage(error),
      });
      return;
    }

    try {
      const acknowledged = await this.redis.xAck(
        STREAMS.SPANS,
        GROUPS.SPAN_WORKERS,
        message.id,
      );

      if (acknowledged !== 1) {
        this.log("error", "span_dlq_acknowledgement_anomaly", {
          messageId: message.id,
          dlqMessageId,
          acknowledged,
        });
        return;
      }

      this.log("info", "span_moved_to_dlq", {
        messageId: message.id,
        dlqMessageId,
        deliveryCount,
      });
    } catch (error) {
      this.log("error", "span_dlq_acknowledgement_failed", {
        messageId: message.id,
        dlqMessageId,
        deliveryCount,
        error: failureMessage(error),
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

  private log(
    level: "info" | "error",
    event: string,
    fields: Record<string, unknown> = {},
  ): void {
    const entry = JSON.stringify({
      event,
      stream: STREAMS.SPANS,
      group: GROUPS.SPAN_WORKERS,
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
