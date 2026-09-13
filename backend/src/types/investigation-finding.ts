export type InvestigationFindingType =
  | "metric_threshold"
  | "log_error"
  | "trace_error";

export type InvestigationFindingSeverity =
  | "info"
  | "warning"
  | "high"
  | "critical";

export interface InvestigationFinding {
  id: string;
  type: InvestigationFindingType;
  severity: InvestigationFindingSeverity;
  timestamp: string;
  message: string;

  service?: string;
  traceId?: string;
  spanId?: string;
}

export interface InvestigationSummary {
  servicesInvolved: string[];
  errorSpans: number;
  metricAnomalies: number;
  logErrors: number;
}
