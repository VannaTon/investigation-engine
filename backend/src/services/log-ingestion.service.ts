import type { LogEvent } from "../types/log-event.js";
import type { EventPublisher } from "../publishers/event.publisher.js";
import type { ApplicationTelemetry } from "../types/application.js";

export class LogIngestionService {
  constructor(private readonly publisher: EventPublisher) {}

  async ingest(event: ApplicationTelemetry<LogEvent>) {
    console.log("LogService received event");

    const eventId = await this.publisher.publish(event);

    console.log("Published event:", eventId);

    return {
      accepted: true,
      eventId,
    };
  }
}
