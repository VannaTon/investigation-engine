import type { EventPublisher } from "./event.publisher.js";
import type { LogEvent } from "../types/log-event.js";

export class RedisPublisher implements EventPublisher {
  constructor(private readonly redis: any) {}
  async publish(event: LogEvent): Promise<string> {
    console.log(event);

    return crypto.randomUUID();
  }
}
