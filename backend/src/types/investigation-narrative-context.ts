import type { InvestigationFindingSeverity } from "./investigation-finding.js";

import type { InvestigationCauseCandidateTracePosition } from "./investigation-cause-candidate-rank.js";

import type { InvestigationSignalType } from "./investigation-signal.js";

import type { InvestigationRankingRationale } from "./investigation-ranking-rationale.js";

export interface InvestigationNarrativeCandidate {
  candidateId: string;
  service: string;

  rank: number;
  tied: boolean;

  highestSeverity: InvestigationFindingSeverity;

  tracePosition: InvestigationCauseCandidateTracePosition;

  supportDiversity: number;
  failureFindingCount: number;

  findingIds: string[];
  signalIds: string[];

  reasons: string[];
}

export interface InvestigationNarrativeFinding {
  findingId: string;

  type: "metric_threshold" | "log_error" | "trace_error";

  severity: InvestigationFindingSeverity;

  timestamp: string;
  message: string;

  service?: string;
  traceId?: string;
  spanId?: string;
}

export interface InvestigationNarrativeMetricTiming {
  service: string;

  findingId: string;

  metricName: string;

  /**
   * Signed difference from the earliest observed
   * trace failure on the same service.
   *
   * Negative = metric sample occurred before.
   * Positive = metric sample occurred after.
   *
   * Context only.
   * NOT used by Cause Candidate Ranking v1.
   */
  observedMetricAnomalyDeltaMs: number;
}

export interface InvestigationNarrativeContext {
  alert: {
    id: string;
    title: string;
    message: string;
    service?: string;
    status: string;
  };

  window: {
    from: string;
    to: string;
  };

  candidates: InvestigationNarrativeCandidate[];

  rankingRationale: InvestigationRankingRationale;

  findings: InvestigationNarrativeFinding[];

  signalTypes: InvestigationSignalType[];

  metricTimings: InvestigationNarrativeMetricTiming[];
}
