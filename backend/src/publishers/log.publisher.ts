import type { LogEvent } from "../types/log-event.js";
import type { RedisClientType } from "@redis/client";
import type { ApplicationTelemetry } from "../types/application.js";

export class LogPublisher {
  constructor(private readonly redis: RedisClientType) {}

  async publish(
    event: ApplicationTelemetry<LogEvent>,
  ): Promise<string> {
    const streamId = await this.redis.xAdd("logs", "*", {
      event: JSON.stringify(event),
    });

    return streamId;
  }
}
