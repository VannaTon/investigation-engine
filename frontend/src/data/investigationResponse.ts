import { InvalidInvestigationResponseError } from "./investigationErrors";
import type { AlertInvestigationResponse } from "../types/investigation";

type JsonRecord = Record<string, unknown>;

const findingTypes = ["metric_threshold", "log_error", "trace_error"] as const;
const findingSeverities = ["info", "warning", "high", "critical"] as const;
const correlationTypes = ["same_span", "same_trace", "temporal_service"] as const;
const signalTypes = [
  "cross_service_failure",
  "multi_signal_evidence",
  "trace_failure_chain",
] as const;
const integrityIssueTypes = [
  "missing_trace_reference",
  "missing_span_reference",
  "service_span_mismatch",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value > 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isOptionalString(record: JsonRecord, key: string): boolean {
  return record[key] === undefined || isString(record[key]);
}

function isMetadata(value: unknown): boolean {
  return value === undefined || isRecord(value);
}

function isMetricEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;

  return (
    isString(value.timestamp) &&
    isString(value.service) &&
    isString(value.name) &&
    (value.type === "counter" || value.type === "gauge") &&
    isNumber(value.value) &&
    isOptionalString(value, "unit") &&
    isMetadata(value.metadata)
  );
}

function isLogEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;

  return (
    isString(value.timestamp) &&
    isString(value.service) &&
    ["debug", "info", "warn", "error"].includes(String(value.level)) &&
    isString(value.message) &&
    isOptionalString(value, "stackTrace") &&
    isOptionalString(value, "traceId") &&
    isOptionalString(value, "spanId") &&
    isOptionalString(value, "environment") &&
    isOptionalString(value, "fingerprint") &&
    isMetadata(value.metadata)
  );
}

function isTraceNode(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 100 || !Array.isArray(value.children)) {
    return false;
  }

  return (
    isString(value.traceId) &&
    isString(value.spanId) &&
    isOptionalString(value, "parentSpanId") &&
    isString(value.service) &&
    isString(value.operation) &&
    isString(value.startTime) &&
    isString(value.endTime) &&
    isNumber(value.durationMs) &&
    (value.status === "ok" || value.status === "error") &&
    isMetadata(value.metadata) &&
    value.children.every((child) => isTraceNode(child, depth + 1))
  );
}

function isTimelineItem(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.timestamp) || !isString(value.type)) {
    return false;
  }

  if (value.type === "metric") return isMetricEvent(value.data);
  if (value.type === "log") return isLogEvent(value.data);
  if (!isRecord(value.data)) return false;

  if (value.type === "alert_fired") {
    return (
      isString(value.data.alertId) &&
      isString(value.data.ruleId) &&
      isString(value.data.title) &&
      isString(value.data.message)
    );
  }

  if (value.type === "alert_resolved") {
    return (
      isString(value.data.alertId) &&
      isString(value.data.ruleId) &&
      isString(value.data.title)
    );
  }

  return false;
}

function isFinding(value: unknown): boolean {
  if (!isRecord(value)) return false;

  return (
    isString(value.id) &&
    findingTypes.includes(value.type as (typeof findingTypes)[number]) &&
    findingSeverities.includes(
      value.severity as (typeof findingSeverities)[number],
    ) &&
    isString(value.timestamp) &&
    isString(value.message) &&
    isOptionalString(value, "service") &&
    isOptionalString(value, "traceId") &&
    isOptionalString(value, "spanId")
  );
}

function isCorrelation(value: unknown): boolean {
  if (!isRecord(value) || !isStringArray(value.findingIds)) return false;

  return (
    isString(value.id) &&
    correlationTypes.includes(
      value.type as (typeof correlationTypes)[number],
    ) &&
    isString(value.message) &&
    isOptionalString(value, "service") &&
    isOptionalString(value, "traceId") &&
    isOptionalString(value, "spanId")
  );
}

function isEvidenceGroup(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isStringArray(value.findingIds) ||
    !isStringArray(value.correlationIds) ||
    !isStringArray(value.services) ||
    !isStringArray(value.traceIds) ||
    !Array.isArray(value.findingTypes) ||
    !Array.isArray(value.correlationTypes)
  ) {
    return false;
  }

  return (
    isString(value.id) &&
    isNonNegativeInteger(value.findingCount) &&
    isNonNegativeInteger(value.correlationCount) &&
    value.findingTypes.every((type) =>
      findingTypes.includes(type as (typeof findingTypes)[number]),
    ) &&
    value.correlationTypes.every((type) =>
      correlationTypes.includes(type as (typeof correlationTypes)[number]),
    ) &&
    isString(value.startedAt) &&
    isString(value.endedAt) &&
    isString(value.message)
  );
}

function isSignal(value: unknown): boolean {
  if (!isRecord(value) || !isStringArray(value.findingIds)) return false;

  return (
    isString(value.id) &&
    signalTypes.includes(value.type as (typeof signalTypes)[number]) &&
    isString(value.evidenceGroupId) &&
    isString(value.message) &&
    (value.services === undefined || isStringArray(value.services)) &&
    isOptionalString(value, "traceId")
  );
}

function isEvidenceRank(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Array.isArray(value.correlationTypes) ||
    !Array.isArray(value.signalTypes) ||
    !isStringArray(value.reasons)
  ) {
    return false;
  }

  return (
    isString(value.findingId) &&
    findingSeverities.includes(
      value.severity as (typeof findingSeverities)[number],
    ) &&
    isNonNegativeInteger(value.severityRank) &&
    isNonNegativeInteger(value.supportScore) &&
    value.correlationTypes.every((type) =>
      correlationTypes.includes(type as (typeof correlationTypes)[number]),
    ) &&
    value.signalTypes.every((type) =>
      signalTypes.includes(type as (typeof signalTypes)[number]),
    )
  );
}

function isIntegrityIssue(value: unknown): boolean {
  if (!isRecord(value)) return false;

  return (
    isString(value.id) &&
    integrityIssueTypes.includes(
      value.type as (typeof integrityIssueTypes)[number],
    ) &&
    isString(value.message) &&
    isOptionalString(value, "logTimestamp") &&
    isOptionalString(value, "service") &&
    isOptionalString(value, "traceId") &&
    isOptionalString(value, "spanId")
  );
}

function isCauseCandidate(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isStringArray(value.findingIds) ||
    !isStringArray(value.signalIds) ||
    !isStringArray(value.traceIds) ||
    !isStringArray(value.reasons)
  ) {
    return false;
  }

  return (
    isString(value.id) &&
    isString(value.service) &&
    isString(value.startedAt) &&
    isString(value.endedAt)
  );
}

function isCauseCandidateFacts(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Array.isArray(value.correlationTypes) ||
    !Array.isArray(value.signalTypes)
  ) {
    return false;
  }

  return (
    isString(value.candidateId) &&
    isString(value.service) &&
    isNonNegativeInteger(value.failureFindingCount) &&
    isNonNegativeInteger(value.logErrorCount) &&
    isNonNegativeInteger(value.traceErrorCount) &&
    findingSeverities.includes(
      value.highestSeverity as (typeof findingSeverities)[number],
    ) &&
    isNonNegativeInteger(value.traceCount) &&
    value.correlationTypes.every((type) =>
      correlationTypes.includes(type as (typeof correlationTypes)[number]),
    ) &&
    value.signalTypes.every((type) =>
      signalTypes.includes(type as (typeof signalTypes)[number]),
    ) &&
    isNonNegativeInteger(value.supportDiversity) &&
    isNonNegativeInteger(value.observedLeafErrorSpanCount) &&
    isNonNegativeInteger(value.observedErrorAncestorSpanCount)
  );
}

function isCauseCandidateRank(value: unknown): boolean {
  if (!isRecord(value) || !isStringArray(value.reasons)) return false;

  return (
    isString(value.candidateId) &&
    isString(value.service) &&
    isPositiveInteger(value.rank) &&
    isBoolean(value.tied) &&
    isNonNegativeInteger(value.severityRank) &&
    [
      "observed_leaf_failure",
      "error_ancestor",
      "other_failure",
    ].includes(String(value.tracePosition)) &&
    isNonNegativeInteger(value.tracePositionRank) &&
    isNonNegativeInteger(value.supportDiversity) &&
    isNonNegativeInteger(value.failureFindingCount)
  );
}

function invalid(reason: string): never {
  throw new InvalidInvestigationResponseError(reason);
}

export function parseInvestigationResponse(
  value: unknown,
): AlertInvestigationResponse {
  if (!isRecord(value)) invalid("response must be an object");

  const alert = value.alert;
  if (
    !isRecord(alert) ||
    !isString(alert.id) ||
    !isString(alert.ruleId) ||
    !["firing", "acknowledged", "resolved"].includes(String(alert.status)) ||
    !isString(alert.title) ||
    !isString(alert.message) ||
    !isOptionalString(alert, "service") ||
    !isString(alert.startedAt) ||
    !isOptionalString(alert, "resolvedAt") ||
    !isString(alert.createdAt) ||
    !isString(alert.updatedAt)
  ) {
    invalid("alert is missing required fields");
  }

  const window = value.window;
  if (!isRecord(window) || !isString(window.from) || !isString(window.to)) {
    invalid("window must contain UTC from and to strings");
  }

  if (!Array.isArray(value.timeline) || !value.timeline.every(isTimelineItem)) {
    invalid("timeline contains an invalid event");
  }

  if (!Array.isArray(value.metrics) || !value.metrics.every(isMetricEvent)) {
    invalid("metrics contains an invalid event");
  }

  if (!Array.isArray(value.logs) || !value.logs.every(isLogEvent)) {
    invalid("logs contains an invalid event");
  }

  if (
    !Array.isArray(value.traces) ||
    !value.traces.every((trace) => isTraceNode(trace))
  ) {
    invalid("traces contains an invalid span tree");
  }

  const summary = value.summary;
  if (
    !isRecord(summary) ||
    !isStringArray(summary.servicesInvolved) ||
    !isNumber(summary.errorSpans) ||
    !isNumber(summary.metricAnomalies) ||
    !isNumber(summary.logErrors)
  ) {
    invalid("summary is missing required counts");
  }

  if (!Array.isArray(value.findings) || !value.findings.every(isFinding)) {
    invalid("findings contains an invalid observation");
  }

  if (
    !Array.isArray(value.correlations) ||
    !value.correlations.every(isCorrelation)
  ) {
    invalid("correlations contains an invalid correlation");
  }

  if (
    !Array.isArray(value.evidenceGroups) ||
    !value.evidenceGroups.every(isEvidenceGroup)
  ) {
    invalid("evidenceGroups contains an invalid evidence group");
  }

  if (!Array.isArray(value.signals) || !value.signals.every(isSignal)) {
    invalid("signals contains an invalid structural signal");
  }

  if (
    !Array.isArray(value.evidenceRanks) ||
    !value.evidenceRanks.every(isEvidenceRank)
  ) {
    invalid("evidenceRanks contains an invalid evidence rank");
  }

  if (
    !Array.isArray(value.integrityIssues) ||
    !value.integrityIssues.every(isIntegrityIssue)
  ) {
    invalid("integrityIssues contains an invalid telemetry reference issue");
  }

  if (
    !Array.isArray(value.causeCandidates) ||
    !value.causeCandidates.every(isCauseCandidate)
  ) {
    invalid("causeCandidates contains an invalid cause candidate");
  }

  if (
    !Array.isArray(value.causeCandidateFacts) ||
    !value.causeCandidateFacts.every(isCauseCandidateFacts)
  ) {
    invalid("causeCandidateFacts contains invalid candidate facts");
  }

  if (
    !Array.isArray(value.causeCandidateRanks) ||
    !value.causeCandidateRanks.every(isCauseCandidateRank)
  ) {
    invalid("causeCandidateRanks contains an invalid candidate rank");
  }

  return value as unknown as AlertInvestigationResponse;
}