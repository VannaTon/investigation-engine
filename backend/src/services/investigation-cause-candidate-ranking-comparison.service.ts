import type { InvestigationCauseCandidateRank } from "../types/investigation-cause-candidate-rank.js";

import type {
  InvestigationRankingDecisiveDimension,
  InvestigationRankingDimension,
} from "../types/investigation-ranking-rationale.js";

export interface InvestigationCauseCandidateRankingDecision {
  order: -1 | 0 | 1;

  decisiveDimension: InvestigationRankingDecisiveDimension;

  dimensionsTiedBeforeDecision: InvestigationRankingDimension[];
}

export const INVESTIGATION_RANKING_DIMENSIONS = [
  "failure_severity",
  "trace_position",
  "support_diversity",
  "failure_finding_count",
] as const satisfies readonly InvestigationRankingDimension[];

export function compareInvestigationCauseCandidateRanks(
  first: InvestigationCauseCandidateRank,
  second: InvestigationCauseCandidateRank,
): InvestigationCauseCandidateRankingDecision {
  const dimensionsTiedBeforeDecision: InvestigationRankingDimension[] = [];

  for (const dimension of INVESTIGATION_RANKING_DIMENSIONS) {
    const firstValue = getDimensionValue(first, dimension);
    const secondValue = getDimensionValue(second, dimension);

    if (firstValue !== secondValue) {
      return {
        order: firstValue > secondValue ? -1 : 1,
        decisiveDimension: dimension,
        dimensionsTiedBeforeDecision,
      };
    }

    dimensionsTiedBeforeDecision.push(dimension);
  }

  return {
    order: 0,
    decisiveDimension: "tie",
    dimensionsTiedBeforeDecision,
  };
}

function getDimensionValue(
  rank: InvestigationCauseCandidateRank,
  dimension: InvestigationRankingDimension,
): number {
  switch (dimension) {
    case "failure_severity":
      return rank.severityRank;

    case "trace_position":
      return rank.tracePositionRank;

    case "support_diversity":
      return rank.supportDiversity;

    case "failure_finding_count":
      return rank.failureFindingCount;
  }
}
