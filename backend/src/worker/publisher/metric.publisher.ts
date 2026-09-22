import type { RedisClientType } from "redis";
import type { MetricEvent } from "../../types/metric-event.js";
import { STREAMS } from "../../constants/stream.js";
import type { ApplicationTelemetry } from "../../types/application.js";

export class MetricsPublisher {
  constructor(private readonly redis: RedisClientType) {}

  async publish(
    event: ApplicationTelemetry<MetricEvent>,
  ): Promise<string> {
    return this.redis.xAdd(STREAMS.METRICS, "*", {
      event: JSON.stringify(event),
    });
  }
}
