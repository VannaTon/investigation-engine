import { joinCauseCandidateRanking } from "./causeCandidates";
import type {
  InvestigationCauseCandidate,
  InvestigationCauseCandidateFacts,
  InvestigationCauseCandidateRank,
  InvestigationFinding,
  InvestigationSignal,
} from "../types/investigation";
import type {
  InvestigationNarrativeCandidateExplanation,
  InvestigationNarrativeTextBlock,
} from "../types/investigationNarrative";

export interface JoinedNarrativeCandidate {
  rank: InvestigationCauseCandidateRank;
  candidate?: InvestigationCauseCandidate;
  facts?: InvestigationCauseCandidateFacts;
  explanation?: InvestigationNarrativeCandidateExplanation;
}

export interface NarrativeFindingReference {
  id: string;
  finding?: InvestigationFinding;
}

export interface NarrativeSignalReference {
  id: string;
  signal?: InvestigationSignal;
}

export interface NarrativeEvidenceReferences {
  findings: NarrativeFindingReference[];
  signals: NarrativeSignalReference[];
}

export function joinNarrativeCandidates(
  ranks: InvestigationCauseCandidateRank[],
  candidates: InvestigationCauseCandidate[],
  facts: InvestigationCauseCandidateFacts[],
  explanations: InvestigationNarrativeCandidateExplanation[],
): JoinedNarrativeCandidate[] {
  const explanationByCandidateId = new Map(
    explanations.map((explanation) => [explanation.candidateId, explanation]),
  );

  return joinCauseCandidateRanking(ranks, candidates, facts).map((item) => ({
    ...item,
    explanation: explanationByCandidateId.get(item.rank.candidateId),
  }));
}

export function resolveNarrativeEvidenceReferences(
  block: InvestigationNarrativeTextBlock,
  findings: InvestigationFinding[],
  signals: InvestigationSignal[],
): NarrativeEvidenceReferences {
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  const signalsById = new Map(signals.map((signal) => [signal.id, signal]));

  return {
    findings: block.findingIds.map((id) => ({
      id,
      finding: findingsById.get(id),
    })),
    signals: block.signalIds.map((id) => ({
      id,
      signal: signalsById.get(id),
    })),
  };
}
