import type { InvestigationCauseCandidateFacts } from "../types/investigation-cause-candidate-facts.js";

import type {
  InvestigationCauseCandidateTracePosition,
  InvestigationCauseCandidateRank,
} from "../types/investigation-cause-candidate-rank.js";

import { compareInvestigationCauseCandidateRanks } from "./investigation-cause-candidate-ranking-comparison.service.js";

export class InvestigationCauseCandidateRankingService {
  createRanks(
    facts: InvestigationCauseCandidateFacts[],
  ): InvestigationCauseCandidateRank[] {
    const ranked = facts.map((candidateFacts) => {
      const tracePosition = this.getTracePosition(candidateFacts);

      const severityRank = this.getSeverityRank(candidateFacts.highestSeverity);

      const tracePositionRank = this.getTracePositionRank(tracePosition);

      return {
        candidateId: candidateFacts.candidateId,

        service: candidateFacts.service,

        rank: 0,
        tied: false,

        severityRank,

        tracePosition,
        tracePositionRank,

        supportDiversity: candidateFacts.supportDiversity,

        failureFindingCount: candidateFacts.failureFindingCount,

        reasons: this.createReasons(candidateFacts, tracePosition),
      };
    });

    ranked.sort(
      (a, b) =>
        compareInvestigationCauseCandidateRanks(a, b).order ||
        a.candidateId.localeCompare(b.candidateId),
    );

    this.assignSemanticRanks(ranked);

    return ranked;
  }

  private assignSemanticRanks(ranks: InvestigationCauseCandidateRank[]): void {
    if (ranks.length === 0) {
      return;
    }

    let currentRank = 1;

    ranks[0]!.rank = currentRank;

    for (let index = 1; index < ranks.length; index++) {
      const previous = ranks[index - 1]!;

      const current = ranks[index]!;

      const tied =
        compareInvestigationCauseCandidateRanks(previous, current).order === 0;

      if (tied) {
        current.rank = previous.rank;

        current.tied = true;
        previous.tied = true;
      } else {
        currentRank = index + 1;

        current.rank = currentRank;
      }
    }
  }

  private getTracePosition(
    facts: InvestigationCauseCandidateFacts,
  ): InvestigationCauseCandidateTracePosition {
    if (facts.observedLeafErrorSpanCount > 0) {
      return "observed_leaf_failure";
    }

    if (facts.observedErrorAncestorSpanCount > 0) {
      return "error_ancestor";
    }

    return "other_failure";
  }

  private getTracePositionRank(
    position: InvestigationCauseCandidateTracePosition,
  ): number {
    switch (position) {
      case "observed_leaf_failure":
        return 2;

      case "error_ancestor":
        return 1;

      case "other_failure":
        return 0;
    }
  }

  private getSeverityRank(
    severity: InvestigationCauseCandidateFacts["highestSeverity"],
  ): number {
    switch (severity) {
      case "critical":
        return 3;

      case "high":
        return 2;

      case "warning":
        return 1;

      case "info":
        return 0;
    }
  }

  private createReasons(
    facts: InvestigationCauseCandidateFacts,
    position: InvestigationCauseCandidateTracePosition,
  ): string[] {
    const reasons: string[] = [
      `Highest failure severity: ${facts.highestSeverity}`,
    ];

    if (position === "observed_leaf_failure") {
      reasons.push("Observed failing leaf span");
    }

    if (position === "error_ancestor") {
      reasons.push("Observed failing ancestor span with error descendant");
    }

    reasons.push(`Structural support diversity: ${facts.supportDiversity}`);

    reasons.push(`Failure findings: ${facts.failureFindingCount}`);

    return reasons;
  }
}
