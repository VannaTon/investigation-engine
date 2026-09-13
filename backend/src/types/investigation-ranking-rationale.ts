import type { InvestigationFindingSeverity } from "./investigation-finding.js";

export type InvestigationRankingDimension =
  | "failure_severity"
  | "trace_position"
  | "support_diversity"
  | "failure_finding_count";

export type InvestigationRankingDecisiveDimension =
  | InvestigationRankingDimension
  | "tie";

export interface InvestigationRankingComparison {
  comparisonId: string;

  firstCandidateId: string;
  secondCandidateId: string;

  firstService: string;
  secondService: string;

  outcome: "first_ranks_ahead" | "tie";

  decisiveDimension: InvestigationRankingDecisiveDimension;

  dimensionsTiedBeforeDecision: InvestigationRankingDimension[];

  deterministicStatement: string;
}

export interface InvestigationRankingRationale {
  candidateOrder: string[];

  allCandidatesSeverityTied: boolean;
  commonSeverity?: InvestigationFindingSeverity;

  comparisons: InvestigationRankingComparison[];
}
