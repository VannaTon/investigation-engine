import type { LogEvent } from "../types/log-event.js";
import type { EventPublisher } from "../publishers/event.publisher.js";

export class LogIngestionService {
  constructor(private readonly publisher: EventPublisher) {}

  async ingest(event: LogEvent) {
    console.log("LogService received event");

    const eventId = await this.publisher.publish(event);

    console.log("Published event:", eventId);

    return {
      accepted: true,
      eventId,
    };
  }
}
