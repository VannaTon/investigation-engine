export interface InvestigationCauseCandidate {
  id: string;

  service: string;

  findingIds: string[];
  signalIds: string[];
  traceIds: string[];

  startedAt: string;
  endedAt: string;

  reasons: string[];
}
