import type { InvestigationFindingType } from "./investigation-finding.js";
import type { InvestigationCorrelationType } from "./investigation-correlation.js";

export interface InvestigationEvidenceGroup {
  id: string;

  findingIds: string[];
  correlationIds: string[];

  services: string[];
  traceIds: string[];

  findingCount: number;
  correlationCount: number;

  findingTypes: InvestigationFindingType[];
  correlationTypes: InvestigationCorrelationType[];

  startedAt: string;
  endedAt: string;

  message: string;
}
