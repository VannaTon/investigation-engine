export type InvestigationCauseCandidateTracePosition =
  | "observed_leaf_failure"
  | "error_ancestor"
  | "other_failure";

export interface InvestigationCauseCandidateRank {
  candidateId: string;
  service: string;

  rank: number;
  tied: boolean;

  severityRank: number;

  tracePosition: InvestigationCauseCandidateTracePosition;

  tracePositionRank: number;

  supportDiversity: number;

  failureFindingCount: number;

  reasons: string[];
}
