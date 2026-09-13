import type {
  InvestigationCauseCandidate,
  InvestigationCauseCandidateFacts,
  InvestigationCauseCandidateRank,
  InvestigationCauseCandidateTracePosition,
} from "../types/investigation";

export interface JoinedCauseCandidate {
  rank: InvestigationCauseCandidateRank;
  candidate?: InvestigationCauseCandidate;
  facts?: InvestigationCauseCandidateFacts;
}

export const tracePositionPresentations: Record<
  InvestigationCauseCandidateTracePosition,
  { label: string; explanation: string }
> = {
  observed_leaf_failure: {
    label: "Observed failing leaf",
    explanation:
      "The observed failing branch ends at this span in the reconstructed trace. This does not establish a confirmed origin.",
  },
  error_ancestor: {
    label: "Error ancestor",
    explanation:
      "A failing span has an observed error descendant in the reconstructed trace.",
  },
  other_failure: {
    label: "Other observed failure",
    explanation:
      "Failure evidence is present without an observed leaf or error-ancestor position.",
  },
};

export function joinCauseCandidateRanking(
  ranks: InvestigationCauseCandidateRank[],
  candidates: InvestigationCauseCandidate[],
  facts: InvestigationCauseCandidateFacts[],
): JoinedCauseCandidate[] {
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const factsById = new Map(facts.map((item) => [item.candidateId, item]));

  return ranks.map((rank) => ({
    rank,
    candidate: candidateById.get(rank.candidateId),
    facts: factsById.get(rank.candidateId),
  }));
}