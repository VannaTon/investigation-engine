export interface InvestigationNarrativeReferences {
  findingIds: string[];
  signalIds: string[];
}

export interface InvestigationNarrativeTextBlock extends InvestigationNarrativeReferences {
  text: string;
}

export interface InvestigationNarrativeCandidateExplanation extends InvestigationNarrativeTextBlock {
  candidateId: string;
}

export interface InvestigationNarrativeOutput {
  summary: InvestigationNarrativeTextBlock;

  candidates: InvestigationNarrativeCandidateExplanation[];
}

export const INVESTIGATION_NARRATIVE_OUTPUT_CONTRACT_VERSION =
  "investigation-narrative-output-v1";
