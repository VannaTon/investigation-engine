export interface HistogramMetricQuery {
  service?: string;
  name?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}
