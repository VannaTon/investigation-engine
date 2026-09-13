export type InvestigationSignalType =
  | "cross_service_failure"
  | "multi_signal_evidence"
  | "trace_failure_chain";

export interface InvestigationSignal {
  id: string;

  type: InvestigationSignalType;

  evidenceGroupId: string;

  findingIds: string[];

  message: string;

  services?: string[];
  traceId?: string;
}
