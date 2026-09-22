export interface MetricAggregateQuery {
  applicationId: string;
  service?: string;
  name: string;
  from?: string;
  to?: string;
}
