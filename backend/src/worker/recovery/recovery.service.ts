import type { RedisClientType } from "redis";
import { StreamMessageHandler } from "../handler/stream-message.handler.js";
import { DlqPublisher } from "../publisher/dlq.publisher.js";
import { STREAMS, GROUPS } from "../../constants/stream.js";
import type { LogEvent } from "../../types/log-event.js";

const MIN_IDLE_TIME = 30000; // 30 seconds
const MAX_DELIVERIES = 3;

export class RecoveryService {
  constructor(
    private readonly redis: RedisClientType,
    private readonly handler: StreamMessageHandler<LogEvent>,
    private readonly dlqPublisher: DlqPublisher,
  ) {}

  async start(): Promise<void> {
    console.log("Recovery service started.");

    while (true) {
      try {
        console.log("Checking for abandoned messages...");

        const result = await this.redis.xAutoClaim(
          STREAMS.LOGS,
          GROUPS.LOG_WORKERS,
          "recovery-worker",
          MIN_IDLE_TIME,
          "0-0",
          {
            COUNT: 10,
          },
        );

        for (const message of result.messages) {
          if (message === null) {
            continue;
          }
          const pending = await this.redis.xPendingRange(
            STREAMS.LOGS,
            GROUPS.LOG_WORKERS,
            message.id,
            message.id,
            1,
          );

          const deliveryCount = pending[0]?.deliveriesCounter ?? 1;

          console.log(`Recovering ${message.id} (delivery #${deliveryCount})`);

          if (deliveryCount >= MAX_DELIVERIES) {
            const payload = message.message.event;

            if (!payload) {
              console.error(`Message ${message.id} has no payload.`);
              continue;
            }

            const event = JSON.parse(payload) as LogEvent;

            await this.dlqPublisher.publish(
              message.id,
              event,
              `Exceeded maximum delivery count (${MAX_DELIVERIES})`,
            );

            await this.redis.xAck(STREAMS.LOGS, GROUPS.LOG_WORKERS, message.id);

            console.log(`Moved ${message.id} to DLQ`);

            continue;
          }

          try {
            await this.handler.handle(message);
          } catch (error) {
            console.error(`Recovery failed for ${message.id}:`, error);
          }
        }
      } catch (error) {
        console.error("Recovery loop error:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
  }
}
