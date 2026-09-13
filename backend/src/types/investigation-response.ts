import type { Alert } from "./alert.js";
import type { InvestigationCauseCandidateFacts } from "./investigation-cause-candidate-facts.js";
import type { InvestigationCauseCandidateRank } from "./investigation-cause-candidate-rank.js";
import type { InvestigationCauseCandidate } from "./investigation-cause-candidate.js";
import type { InvestigationCorrelation } from "./investigation-correlation.js";
import type { InvestigationEvidenceGroup } from "./investigation-evidence-group.js";
import type { InvestigationEvidenceRank } from "./investigation-evidence-rank.js";
import type {
  InvestigationFinding,
  InvestigationSummary,
} from "./investigation-finding.js";
import type { InvestigationIntegrityIssue } from "./investigation-integrity-issue.js";
import type { InvestigationSignal } from "./investigation-signal.js";
import type { InvestigationTimelineItem } from "./investigation.js";
import type { LogEvent } from "./log-event.js";
import type { MetricEvent } from "./metric-event.js";
import type { TraceNode } from "./trace-tree.js";

export interface InvestigationResponseV1 {
  alert: Alert;
  window: {
    from: string;
    to: string;
  };
  timeline: InvestigationTimelineItem[];
  metrics: MetricEvent[];
  logs: LogEvent[];
  traces: TraceNode[];
  summary: InvestigationSummary;
  findings: InvestigationFinding[];
  correlations: InvestigationCorrelation[];
  evidenceGroups: InvestigationEvidenceGroup[];
  signals: InvestigationSignal[];
  evidenceRanks: InvestigationEvidenceRank[];
  integrityIssues: InvestigationIntegrityIssue[];
  causeCandidates: InvestigationCauseCandidate[];
  causeCandidateFacts: InvestigationCauseCandidateFacts[];
  causeCandidateRanks: InvestigationCauseCandidateRank[];
}
