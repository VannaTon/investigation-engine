import type { RedisClientType } from "redis";
import { STREAMS } from "../../constants/stream.js";
import type { LogEvent } from "../../types/log-event.js";

export class DlqPublisher {
  constructor(private readonly redis: RedisClientType) {}

  async publishFields(fields: Record<string, string>): Promise<string> {
    return this.redis.xAdd(STREAMS.DLQ, "*", fields);
  }

  async publish(
    messageId: string,
    event: LogEvent,
    reason: string,
  ): Promise<string> {
    return this.redis.xAdd(STREAMS.DLQ, "*", {
      originalMessageId: messageId,
      reason,
      event: JSON.stringify(event),
      failedAt: new Date().toISOString(),
    });
  }
}
