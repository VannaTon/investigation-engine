import type { MetricEvent } from "../types/metric-event.js";
import { MetricsPublisher } from "../worker/publisher/metric.publisher.js";

export class MetricService {
  constructor(private readonly publisher: MetricsPublisher) {}

  async ingest(event: MetricEvent) {
    const evenId = await this.publisher.publish(event);
    return {
      acceptd: true,
      evenId,
    };
  }
}
