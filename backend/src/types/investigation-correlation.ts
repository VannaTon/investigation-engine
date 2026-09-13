export type InvestigationCorrelationType =
  | "same_span"
  | "same_trace"
  | "temporal_service";

export interface InvestigationCorrelation {
  id: string;
  type: InvestigationCorrelationType;
  findingIds: string[];
  message: string;

  service?: string;
  traceId?: string;
  spanId?: string;
}
