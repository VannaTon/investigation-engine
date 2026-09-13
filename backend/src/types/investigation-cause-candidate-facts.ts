import type { InvestigationFindingSeverity } from "./investigation-finding.js";
import type { InvestigationCorrelationType } from "./investigation-correlation.js";
import type { InvestigationSignalType } from "./investigation-signal.js";

export interface InvestigationCauseCandidateFacts {
  candidateId: string;
  service: string;
  failureFindingCount: number;
  logErrorCount: number;
  traceErrorCount: number;
  highestSeverity: InvestigationFindingSeverity;
  traceCount: number;
  correlationTypes: InvestigationCorrelationType[];
  signalTypes: InvestigationSignalType[];
  supportDiversity: number;
  observedLeafErrorSpanCount: number;
  observedErrorAncestorSpanCount: number;
}
