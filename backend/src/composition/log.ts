import { redis } from "../config/redis.js";
import { LogPublisher } from "../publishers/log.publisher.js";
import { LogRepository } from "../repository/log.repository.js";
import { LogIngestionService } from "../services/log-ingestion.service.js";
import { LogQueryService } from "../services/log-query.service.js";
import { ErrorGroupRepository } from "../repository/error-group.repository.js";
import { LogProcessor } from "../worker/processor/log.processor.js";
import { isLogRecoveryEnabled } from "../config/log-recovery.js";

const publisher = new LogPublisher(redis);

const repository = new LogRepository();

export const logIngestionService = new LogIngestionService(publisher);
export const errorGroupRepository = new ErrorGroupRepository();
export const processor = new LogProcessor(repository, errorGroupRepository, {
  replayProtectionEnabled: isLogRecoveryEnabled(),
});

export const logQueryService = new LogQueryService(repository);
