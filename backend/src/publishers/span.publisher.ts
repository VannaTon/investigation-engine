import type { RedisClientType } from "redis";
import type { Span } from "../types/span.js";
import { STREAMS } from "../constants/stream.js";

export class SpanPublisher {
  constructor(private readonly redis: RedisClientType) {}

  async publish(span: Span): Promise<string> {
    return this.redis.xAdd(STREAMS.SPANS, "*", {
      event: JSON.stringify(span),
    });
  }
}
