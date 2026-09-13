import { MetricRepository } from "../repository/metric.repository.js";
import type { MetricQueryResult } from "./../types/metric-query-result.js";
import type { MetricQuery } from "../types/metrics-query.js";
import type { MetricAggregateQuery } from "../types/metric-aggregate-query.js";
import type { MetricAggregateResult } from "../types/metric-aggregate-result.js";
import type { MetricEvent } from "../types/metric-event.js";

export class MetricQueryService {
  constructor(private readonly repository: MetricRepository) {}

  async find(query: MetricQuery): Promise<MetricQueryResult> {
    return this.repository.find(query);
  }

  async aggregate(query: MetricAggregateQuery): Promise<MetricAggregateResult> {
    return this.repository.aggregate(query);
  }

  async findForInvestigation(
    service: string,
    from: string,
    to: string,
  ): Promise<MetricEvent[]> {
    return this.repository.findForInvestigation(service, from, to);
  }
}
