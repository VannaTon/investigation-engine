export const STREAMS = {
  LOGS: "logs",
  SPANS: "spans",
  DLQ: "dlq",
  METRICS: "metrics",
  METRIC_HISTOGRAMS: "metric_histograms",
} as const;

export const GROUPS = {
  LOG_WORKERS: "log-workers",
  SPAN_WORKERS: "span-workers",
  METRIC_WORKERS: "metric_workers",
  METRIC_HISTOGRAM_WORKERS: "metric_histogram_workers",
} as const;
