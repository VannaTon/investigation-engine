import type { HistogramMetricEvent } from "../types/histogram-metric-event.js";
import { HistogramMetricPublisher } from "../worker/publisher/histogram-metric.publisher.js";

export class HistogramMetricService {
  constructor(private readonly publisher: HistogramMetricPublisher) {}

  async ingest(event: HistogramMetricEvent): Promise<{
    accepted: true;
    eventId: string;
  }> {
    const eventId = await this.publisher.publish(event);

    return {
      accepted: true,
      eventId,
    };
  }
}
