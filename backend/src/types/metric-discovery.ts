export interface MetricDiscoveryWindow {
  from: string;
  to: string;
}

export interface MetricDiscoveryPage<T> {
  data: T[];
  hasMore: boolean;
  window: MetricDiscoveryWindow;
}

export interface DiscoveredMetric {
  name: string;
  types: string[];
  // An empty string denotes telemetry with no unit; no conversion is applied.
  units: string[];
  lastSeen: string;
  metadataTruncated: boolean;
}

export interface DiscoveredMetricsResult extends MetricDiscoveryPage<DiscoveredMetric> {
  service: string;
}

export interface MetricDiscoveryQuery {
  applicationId: string;
  limit: number;
}

export interface ServiceMetricDiscoveryQuery extends MetricDiscoveryQuery {
  service: string;
}
