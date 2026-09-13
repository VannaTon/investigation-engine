export type InvestigationIntegrityIssueType =
  | "missing_trace_reference"
  | "missing_span_reference"
  | "service_span_mismatch";

export interface InvestigationIntegrityIssue {
  id: string;
  type: InvestigationIntegrityIssueType;
  message: string;

  logTimestamp?: string;
  service?: string;
  traceId?: string;
  spanId?: string;
}
