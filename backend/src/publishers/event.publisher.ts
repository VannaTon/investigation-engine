import type { LogEvent } from "../types/log-event.js";

export interface EventPublisher {
  publish(event: LogEvent): Promise<string>;
}
