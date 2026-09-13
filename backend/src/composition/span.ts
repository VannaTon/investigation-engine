import { redis } from "../config/redis.js";
import { SpanPublisher } from "../publishers/span.publisher.js";
import { SpanIngestionService } from "../services/span-ingestion.service.js";

const publisher = new SpanPublisher(redis);

export const spanIngestionService = new SpanIngestionService(publisher);
