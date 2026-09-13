import type { LogEvent } from "../types/log-event.js";
import type { RedisClientType } from "@redis/client";

export class LogPublisher {
  constructor(private readonly redis: RedisClientType) {}

  async publish(event: LogEvent): Promise<string> {
    const streamId = await this.redis.xAdd("logs", "*", {
      event: JSON.stringify(event),
    });

    return streamId;
  }
}
