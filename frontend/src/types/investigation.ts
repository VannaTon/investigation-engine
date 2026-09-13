export type AlertStatus = "firing" | "acknowledged" | "resolved";

export interface InvestigationAlert {
  id: string;
  ruleId: string;
  status: AlertStatus;
  title: string;
  message: string;
  service?: string;
  startedAt: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MetricEvent {
  timestamp: string;
  service: string;
  name: string;
  type: "counter" | "gauge";
  value: number;
  unit?: string;
  metadata?: Record<string, unknown>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  timestamp: string;
  service: string;
  level: LogLevel;
  message: string;
  stackTrace?: string;
  traceId?: string;
  spanId?: string;
  environment?: string;
  metadata?: Record<string, unknown>;
  fingerprint?: string;
}

export type SpanStatus = "ok" | "error";

export interface TraceNode {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  service: string;
  operation: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  status: SpanStatus;
  metadata?: Record<string, unknown>;
  children: TraceNode[];
}

export type InvestigationTimelineItem =
  | {
      timestamp: string;
      type: "metric";
      data: MetricEvent;
    }
  | {
      timestamp: string;
      type: "log";
      data: LogEvent;
    }
  | {
      timestamp: string;
      type: "alert_fired";
      data: {
        alertId: string;
        ruleId: string;
        title: string;
        message: string;
      };
    }
  | {
      timestamp: string;
      type: "alert_resolved";
      data: {
        alertId: string;
        ruleId: string;
        title: string;
      };
    };

export type InvestigationFindingType =
  | "metric_threshold"
  | "log_error"
  | "trace_error";

export type InvestigationFindingSeverity =
  | "info"
  | "warning"
  | "high"
  | "critical";

export interface InvestigationFinding {
  id: string;
  type: InvestigationFindingType;
  severity: InvestigationFindingSeverity;
  timestamp: string;
  message: string;
  service?: string;
  traceId?: string;
  spanId?: string;
}

export type InvestigationCorrelationType =
  | "same_span"
  | "same_trace"
  | "temporal_service";

export interface InvestigationCorrelation {
  id: string;
  type: InvestigationCorrelationType;
  findingIds: string[];
  message: string;
  service?: string;
  traceId?: string;
  spanId?: string;
}

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

export type InvestigationSignalType =
  | "cross_service_failure"
  | "multi_signal_evidence"
  | "trace_failure_chain";

export interface InvestigationSignal {
  id: string;
  type: InvestigationSignalType;
  evidenceGroupId: string;
  findingIds: string[];
  message: string;
  services?: string[];
  traceId?: string;
}

export interface InvestigationEvidenceRank {
  findingId: string;
  severity: InvestigationFindingSeverity;
  severityRank: number;
  supportScore: number;
  correlationTypes: InvestigationCorrelationType[];
  signalTypes: InvestigationSignalType[];
  reasons: string[];
}

export type InvestigationIntegrityIssueType =
  | "missing_trace_reference"
  | "missing_span_reference"
  | "service_span_mismatch";

export interface InvestigationIntegrityIssue {
  id: string;
  type: InvestigationIntegrityIssueType;
  message: string;
  logTimestamp?: string;
  service?: string;
  traceId?: string;
  spanId?: string;
}

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

export type InvestigationCauseCandidateTracePosition =
  | "observed_leaf_failure"
  | "error_ancestor"
  | "other_failure";

export interface InvestigationCauseCandidateRank {
  candidateId: string;
  service: string;
  rank: number;
  tied: boolean;
  severityRank: number;
  tracePosition: InvestigationCauseCandidateTracePosition;
  tracePositionRank: number;
  supportDiversity: number;
  failureFindingCount: number;
  reasons: string[];
}
export interface AlertInvestigationResponse {
  alert: InvestigationAlert;
  window: {
    from: string;
    to: string;
  };
  timeline: InvestigationTimelineItem[];
  metrics: MetricEvent[];
  logs: LogEvent[];
  traces: TraceNode[];
  summary: {
    servicesInvolved: string[];
    errorSpans: number;
    metricAnomalies: number;
    logErrors: number;
  };
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

