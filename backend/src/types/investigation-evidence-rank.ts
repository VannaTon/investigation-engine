import type { InvestigationFindingSeverity } from "./investigation-finding.js";

import type { InvestigationCorrelationType } from "./investigation-correlation.js";

import type { InvestigationSignalType } from "./investigation-signal.js";

export interface InvestigationEvidenceRank {
  findingId: string;

  severity: InvestigationFindingSeverity;
  severityRank: number;

  supportScore: number;

  correlationTypes: InvestigationCorrelationType[];
  signalTypes: InvestigationSignalType[];

  reasons: string[];
}
