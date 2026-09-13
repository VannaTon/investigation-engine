import type { RedisClientType } from "redis";
import { GROUPS, STREAMS } from "../../constants/stream.js";
import type { HistogramMetricEvent } from "../../types/histogram-metric-event.js";
import type { StreamMessageHandler } from "../handler/stream-message.handler.js";
import type { DlqPublisher } from "../publisher/dlq.publisher.js";
import {
  MetricRecoveryService,
  type MetricRecoveryOptions,
} from "./metric-recovery.service.js";

export const HISTOGRAM_METRIC_RECOVERY_FAILURE_CODE =
  "HISTOGRAM_METRIC_PROCESSING_FAILED";

export type HistogramMetricRecoveryOptions = Omit<
  MetricRecoveryOptions,
  "streamName" | "groupName" | "failureCode" | "logPrefix"
>;

export class HistogramMetricRecoveryService extends MetricRecoveryService<HistogramMetricEvent> {
  constructor(
    redis: RedisClientType,
    handler: StreamMessageHandler<HistogramMetricEvent>,
    dlqPublisher: DlqPublisher,
    consumerName: string,
    options: HistogramMetricRecoveryOptions = {},
  ) {
    super(redis, handler, dlqPublisher, consumerName, {
      ...options,
      streamName: STREAMS.METRIC_HISTOGRAMS,
      groupName: GROUPS.METRIC_HISTOGRAM_WORKERS,
      failureCode: HISTOGRAM_METRIC_RECOVERY_FAILURE_CODE,
      logPrefix: "histogram_metric",
    });
  }
}
