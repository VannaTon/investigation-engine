import { redis } from "../config/redis.js";
import { MetricRepository } from "../repository/metric.repository.js";
import { MetricProcessor } from "../worker/processor/metric.processor.js";
import { StreamMessageHandler } from "../worker/handler/stream-message.handler.js";
import { StreamConsumer } from "../worker/consumer/stream.consumer.js";
import { STREAMS, GROUPS } from "../constants/stream.js";
import { metricAlertEvaluator } from "./metric-alert.js";
import { DlqPublisher } from "../worker/publisher/dlq.publisher.js";
import { MetricRecoveryService } from "../worker/recovery/metric-recovery.service.js";
import { MetricStorageReadinessService } from "../services/metric-storage-readiness.service.js";
import { resolveConsumerName } from "../worker/consumer/consumer-name.js";

const metricsrepository = new MetricRepository();

const processor = new MetricProcessor(metricsrepository, metricAlertEvaluator);
const metricConsumerName = resolveConsumerName(GROUPS.METRIC_WORKERS);

const handler = new StreamMessageHandler(
  redis,
  STREAMS.METRICS,
  GROUPS.METRIC_WORKERS,
  processor,
  {
    consumerName: metricConsumerName,
    requireSingleAcknowledgement: true,
  },
);

const metricWorker = new StreamConsumer(
  redis,
  metricConsumerName,
  STREAMS.METRICS,
  GROUPS.METRIC_WORKERS,
  handler,
);

const metricRecovery = new MetricRecoveryService(
  redis,
  handler,
  new DlqPublisher(redis),
  metricConsumerName,
);

const metricStorageReadiness = new MetricStorageReadinessService();

export {
  metricConsumerName,
  metricRecovery,
  metricStorageReadiness,
  metricWorker,
};
