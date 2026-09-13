import type { InvestigationCauseCandidateFacts } from "../types/investigation-cause-candidate-facts.js";

import type {
  InvestigationCauseCandidateRank,
  InvestigationCauseCandidateTracePosition,
} from "../types/investigation-cause-candidate-rank.js";

import type {
  InvestigationRankingComparison,
  InvestigationRankingRationale,
} from "../types/investigation-ranking-rationale.js";

import { compareInvestigationCauseCandidateRanks } from "./investigation-cause-candidate-ranking-comparison.service.js";

export function createInvestigationRankingRationale(
  ranks: InvestigationCauseCandidateRank[],
  facts: InvestigationCauseCandidateFacts[],
): InvestigationRankingRationale {
  const factsByCandidateId = new Map(
    facts.map((candidateFacts) => [
      candidateFacts.candidateId,
      candidateFacts,
    ]),
  );

  const orderedFacts = ranks.map((rank) => {
    const candidateFacts = factsByCandidateId.get(rank.candidateId);

    if (!candidateFacts) {
      throw new Error(
        `Missing cause candidate facts for ranking rationale: ${rank.candidateId}`,
      );
    }

    return candidateFacts;
  });

  const commonSeverity = orderedFacts[0]?.highestSeverity;

  const allCandidatesSeverityTied =
    commonSeverity !== undefined &&
    orderedFacts.every(
      (candidateFacts) =>
        candidateFacts.highestSeverity === commonSeverity,
    );

  const comparisons: InvestigationRankingComparison[] = [];

  for (let index = 0; index < ranks.length - 1; index++) {
    const first = ranks[index]!;
    const second = ranks[index + 1]!;
    const firstFacts = orderedFacts[index]!;
    const secondFacts = orderedFacts[index + 1]!;

    comparisons.push(
      createComparison(first, second, firstFacts, secondFacts),
    );
  }

  return {
    candidateOrder: ranks.map((rank) => rank.candidateId),
    allCandidatesSeverityTied,
    ...(allCandidatesSeverityTied && commonSeverity !== undefined
      ? {
          commonSeverity,
        }
      : {}),
    comparisons,
  };
}

function createComparison(
  first: InvestigationCauseCandidateRank,
  second: InvestigationCauseCandidateRank,
  firstFacts: InvestigationCauseCandidateFacts,
  secondFacts: InvestigationCauseCandidateFacts,
): InvestigationRankingComparison {
  const decision = compareInvestigationCauseCandidateRanks(first, second);

  if (decision.order > 0) {
    throw new Error(
      `Cause candidate ranks are not in deterministic order: ${first.candidateId}, ${second.candidateId}`,
    );
  }

  const outcome = decision.order === 0 ? "tie" : "first_ranks_ahead";

  if (outcome === "tie") {
    if (first.rank !== second.rank || !first.tied || !second.tied) {
      throw new Error(
        `Semantically equal candidates must share a tied rank: ${first.candidateId}, ${second.candidateId}`,
      );
    }
  } else if (first.rank >= second.rank) {
    throw new Error(
      `Ordered candidates must have increasing semantic ranks: ${first.candidateId}, ${second.candidateId}`,
    );
  }

  return {
    comparisonId: `ranking_comparison:${first.candidateId}:${second.candidateId}`,
    firstCandidateId: first.candidateId,
    secondCandidateId: second.candidateId,
    firstService: first.service,
    secondService: second.service,
    outcome,
    decisiveDimension: decision.decisiveDimension,
    dimensionsTiedBeforeDecision: [
      ...decision.dimensionsTiedBeforeDecision,
    ],
    deterministicStatement: createDeterministicStatement(
      first,
      second,
      firstFacts,
      secondFacts,
      decision.decisiveDimension,
    ),
  };
}

function createDeterministicStatement(
  first: InvestigationCauseCandidateRank,
  second: InvestigationCauseCandidateRank,
  firstFacts: InvestigationCauseCandidateFacts,
  secondFacts: InvestigationCauseCandidateFacts,
  decisiveDimension: InvestigationRankingComparison["decisiveDimension"],
): string {
  switch (decisiveDimension) {
    case "failure_severity":
      return (
        `${first.service} ranks ahead of ${second.service} because failure severity is the first differing ranking dimension: ` +
        `${first.service} has ${firstFacts.highestSeverity} failure severity while ` +
        `${second.service} has ${secondFacts.highestSeverity} failure severity.`
      );

    case "trace_position":
      return (
        `Both candidates have ${firstFacts.highestSeverity} failure severity. ` +
        `${first.service} ranks ahead of ${second.service} because trace position is the first differing ranking dimension: ` +
        `${first.service} is ${describeTracePosition(first.tracePosition)} while ` +
        `${second.service} is ${describeTracePosition(second.tracePosition)}.`
      );

    case "support_diversity":
      return (
        `Both candidates tie on failure severity (${firstFacts.highestSeverity}) and trace position (${describeTracePosition(first.tracePosition)}). ` +
        `${first.service} ranks ahead of ${second.service} because structural support diversity is the first differing ranking dimension: ` +
        `${first.supportDiversity} versus ${second.supportDiversity}.`
      );

    case "failure_finding_count":
      return (
        `Both candidates tie on failure severity (${firstFacts.highestSeverity}), trace position (${describeTracePosition(first.tracePosition)}), and structural support diversity (${first.supportDiversity}). ` +
        `${first.service} ranks ahead of ${second.service} because failure finding count is the first differing ranking dimension: ` +
        `${first.failureFindingCount} versus ${second.failureFindingCount}.`
      );

    case "tie":
      return (
        `${first.service} and ${second.service} are co-equal cause candidates at rank ${first.rank}; ` +
        `failure severity (${firstFacts.highestSeverity}), trace position (${describeTracePosition(first.tracePosition)}), ` +
        `structural support diversity (${first.supportDiversity}), and failure finding count (${first.failureFindingCount}) are tied.`
      );
  }
}

function describeTracePosition(
  position: InvestigationCauseCandidateTracePosition,
): string {
  switch (position) {
    case "observed_leaf_failure":
      return "an observed failing leaf";

    case "error_ancestor":
      return "an error ancestor";

    case "other_failure":
      return "other observed failure evidence";
  }
}
