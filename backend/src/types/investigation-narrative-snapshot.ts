import type { InvestigationNarrativeOutput } from "./investigation-narrative-output.js";

export interface InvestigationNarrativeSnapshot {
  evidenceCutoff: string;
  generatedAt: string;
  contextHash: string;
  narrative: InvestigationNarrativeOutput;
}
