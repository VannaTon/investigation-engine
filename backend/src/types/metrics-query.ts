export interface MetricQuery {
  applicationId: string;
  service?: string;
  name?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}
