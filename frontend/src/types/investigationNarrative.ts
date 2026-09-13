export interface InvestigationNarrativeTextBlock {
  text: string;
  findingIds: string[];
  signalIds: string[];
}

export interface InvestigationNarrativeCandidateExplanation
  extends InvestigationNarrativeTextBlock {
  candidateId: string;
}

export interface InvestigationNarrativeOutput {
  summary: InvestigationNarrativeTextBlock;
  candidates: InvestigationNarrativeCandidateExplanation[];
}

export interface InvestigationNarrativeSnapshot {
  evidenceCutoff: string;
  generatedAt: string;
  contextHash: string;
  narrative: InvestigationNarrativeOutput;
}

export type NarrativeApiErrorCode =
  | "NARRATIVE_PROVIDER_TIMEOUT"
  | "NARRATIVE_PROVIDER_UNAVAILABLE"
  | "NARRATIVE_PROVIDER_ERROR"
  | "NARRATIVE_PROVIDER_INVALID_RESPONSE"
  | "NARRATIVE_INVALID_OUTPUT"
  | "NARRATIVE_GROUNDING_FAILED"
  | "NARRATIVE_SEMANTIC_VALIDATION_FAILED"
  | "NARRATIVE_GENERATION_COOLDOWN"
  | "NARRATIVE_NOT_CONFIGURED"
  | "NARRATIVE_NETWORK_ERROR"
  | "NARRATIVE_INVALID_RESPONSE"
  | "NARRATIVE_HTTP_ERROR"
  | "UNKNOWN";

export class NarrativeApiError extends Error {
  constructor(
    public readonly code: NarrativeApiErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
    public readonly backendMessage?: string,
  ) {
    super(message);
    this.name = "NarrativeApiError";
  }
}
