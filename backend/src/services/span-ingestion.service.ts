import type { Span } from "../types/span.js";
import { SpanPublisher } from "../publishers/span.publisher.js";

export class SpanIngestionService {
  constructor(private readonly publisher: SpanPublisher) {}

  async ingest(span: Span) {
    const eventId = await this.publisher.publish(span);

    return {
      accepted: true,
      eventId: eventId,
    };
  }
}
