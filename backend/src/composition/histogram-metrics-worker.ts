import { redis } from "../config/redis.js";
import { GROUPS, STREAMS } from "../constants/stream.js";
import { HistogramMetricRepository } from "../repository/histogram-metric.repository.js";
import { HistogramMetricStorageReadinessService } from "../services/histogram-metric-storage-readiness.service.js";
import type { HistogramMetricEvent } from "../types/histogram-metric-event.js";
import { StreamConsumer } from "../worker/consumer/stream.consumer.js";
import { StreamMessageHandler } from "../worker/handler/stream-message.handler.js";
import { HistogramMetricProcessor } from "../worker/processor/histogram-metric.processor.js";
import { DlqPublisher } from "../worker/publisher/dlq.publisher.js";
import { HistogramMetricRecoveryService } from "../worker/recovery/histogram-metric-recovery.service.js";
import { resolveConsumerName } from "../worker/consumer/consumer-name.js";

const repository = new HistogramMetricRepository();
const processor = new HistogramMetricProcessor(repository);
const histogramMetricConsumerName = resolveConsumerName(
  GROUPS.METRIC_HISTOGRAM_WORKERS,
);

const handler = new StreamMessageHandler<HistogramMetricEvent>(
  redis,
  STREAMS.METRIC_HISTOGRAMS,
  GROUPS.METRIC_HISTOGRAM_WORKERS,
  processor,
  {
    consumerName: histogramMetricConsumerName,
    requireSingleAcknowledgement: true,
  },
);

const histogramMetricWorker = new StreamConsumer(
  redis,
  histogramMetricConsumerName,
  STREAMS.METRIC_HISTOGRAMS,
  GROUPS.METRIC_HISTOGRAM_WORKERS,
  handler,
);

const histogramMetricRecovery = new HistogramMetricRecoveryService(
  redis,
  handler,
  new DlqPublisher(redis),
  histogramMetricConsumerName,
);

const histogramMetricStorageReadiness =
  new HistogramMetricStorageReadinessService();

export {
  histogramMetricConsumerName,
  histogramMetricRecovery,
  histogramMetricStorageReadiness,
  histogramMetricWorker,
};
