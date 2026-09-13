import { redis } from "../config/redis.js";
import { HistogramMetricRepository } from "../repository/histogram-metric.repository.js";
import { HistogramMetricQueryService } from "../services/histogram-metric-query.service.js";
import { HistogramMetricService } from "../services/histogram-metric.service.js";
import { HistogramMetricPublisher } from "../worker/publisher/histogram-metric.publisher.js";

const histogramMetricRepository = new HistogramMetricRepository();
const histogramMetricPublisher = new HistogramMetricPublisher(redis);

export const histogramMetricService = new HistogramMetricService(
  histogramMetricPublisher,
);
export const histogramMetricQueryService =
  new HistogramMetricQueryService(histogramMetricRepository);
