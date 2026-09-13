export interface MetricAggregateResult {
  name: string;
  service?: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  sum: number;
}
