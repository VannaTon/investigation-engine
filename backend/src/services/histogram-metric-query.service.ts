import { HistogramMetricRepository } from "../repository/histogram-metric.repository.js";
import type { HistogramMetricQuery } from "../types/histogram-metric-query.js";
import type { HistogramMetricQueryResult } from "../types/histogram-metric-query-result.js";

export class HistogramMetricQueryService {
  constructor(private readonly repository: HistogramMetricRepository) {}

  async find(
    query: HistogramMetricQuery,
  ): Promise<HistogramMetricQueryResult> {
    return this.repository.find(query);
  }
}
