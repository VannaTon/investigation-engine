import type { RedisClientType } from "redis";
import { STREAMS } from "../../constants/stream.js";
import type { HistogramMetricEvent } from "../../types/histogram-metric-event.js";

export class HistogramMetricPublisher {
  constructor(private readonly redis: RedisClientType) {}

  async publish(event: HistogramMetricEvent): Promise<string> {
    return this.redis.xAdd(STREAMS.METRIC_HISTOGRAMS, "*", {
      event: JSON.stringify(event),
    });
  }
}
