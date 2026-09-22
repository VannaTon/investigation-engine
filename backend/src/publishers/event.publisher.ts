import type { LogEvent } from "../types/log-event.js";
import type { ApplicationTelemetry } from "../types/application.js";

export interface EventPublisher {
  publish(
    event: ApplicationTelemetry<LogEvent>,
  ): Promise<string>;
}
