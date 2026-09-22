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
    label: "Failing step at branch end",
    explanation:
      "The recorded failing branch ends at this step (span) in the call path. This does not confirm where the failure started.",
  },
  error_ancestor: {
    label: "Failure with nested failing steps",
    explanation:
      "This failing step (span) has another recorded failing step below it in the call path.",
  },
  other_failure: {
    label: "Other recorded failure",
    explanation:
      "A failure was recorded, but its place in the call path is neither an observed branch end nor a failing step with nested errors.",
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
