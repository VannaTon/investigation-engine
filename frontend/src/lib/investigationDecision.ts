import type {
  InvestigationCauseCandidate,
  InvestigationCauseCandidateRank,
  InvestigationCorrelation,
  InvestigationFinding,
  InvestigationSignal,
} from "../types/investigation";

export type DecisionEvidenceKind =
  | "exact_span_error_log"
  | "metric_threshold"
  | "cross_service_failure"
  | "trace_failure_chain";

export interface DecisionEvidence {
  kind: DecisionEvidenceKind;
  label: string;
}

export interface InvestigationDecision {
  leadingRank?: number;
  coLeading: boolean;
  leadingCandidateIds: ReadonlySet<string>;
  evidenceByCandidateId: ReadonlyMap<string, readonly DecisionEvidence[]>;
}

const evidenceLabels: Record<DecisionEvidenceKind, string> = {
  exact_span_error_log: "Exact-span ERROR log",
  metric_threshold: "Metric threshold evidence",
  cross_service_failure: "Cross-service failure",
  trace_failure_chain: "Trace failure chain",
};

export function buildInvestigationDecision(
  ranks: InvestigationCauseCandidateRank[],
  candidates: InvestigationCauseCandidate[],
  findings: InvestigationFinding[],
  correlations: InvestigationCorrelation[],
  signals: InvestigationSignal[],
): InvestigationDecision {
  const leadingRank =
    ranks.length === 0 ? undefined : Math.min(...ranks.map((rank) => rank.rank));
  const leadingCandidates = ranks.filter((rank) => rank.rank === leadingRank);
  const leadingCandidateIds = new Set(
    leadingCandidates.map((rank) => rank.candidateId),
  );
  const coLeading =
    leadingCandidates.length > 1 || leadingCandidates.some((rank) => rank.tied);
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  const signalsById = new Map(signals.map((signal) => [signal.id, signal]));
  const evidenceByCandidateId = new Map<string, readonly DecisionEvidence[]>();

  for (const candidate of candidates) {
    const candidateFindingIds = new Set(candidate.findingIds);
    const directSignals = candidate.signalIds.flatMap((signalId) => {
      const signal = signalsById.get(signalId);
      return signal ? [signal] : [];
    });
    const referencedFindingIds = new Set([
      ...candidate.findingIds,
      ...directSignals.flatMap((signal) => signal.findingIds),
    ]);
    const evidence: DecisionEvidence[] = [];

    const hasExactSpanErrorLog = correlations.some((correlation) => {
      if (correlation.type !== "same_span") return false;

      const candidateFindings = correlation.findingIds
        .filter((findingId) => candidateFindingIds.has(findingId))
        .flatMap((findingId) => {
          const finding = findingsById.get(findingId);
          return finding ? [finding] : [];
        });

      return (
        candidateFindings.some((finding) => finding.type === "log_error") &&
        candidateFindings.some((finding) => finding.type === "trace_error")
      );
    });
    if (hasExactSpanErrorLog) {
      evidence.push({
        kind: "exact_span_error_log",
        label: evidenceLabels.exact_span_error_log,
      });
    }

    const hasMetricThreshold = [...referencedFindingIds].some((findingId) => {
      const finding = findingsById.get(findingId);
      return (
        finding?.type === "metric_threshold" &&
        finding.service === candidate.service
      );
    });
    if (hasMetricThreshold) {
      evidence.push({
        kind: "metric_threshold",
        label: evidenceLabels.metric_threshold,
      });
    }

    if (directSignals.some((signal) => signal.type === "cross_service_failure")) {
      evidence.push({
        kind: "cross_service_failure",
        label: evidenceLabels.cross_service_failure,
      });
    }

    if (directSignals.some((signal) => signal.type === "trace_failure_chain")) {
      evidence.push({
        kind: "trace_failure_chain",
        label: evidenceLabels.trace_failure_chain,
      });
    }

    evidenceByCandidateId.set(candidate.id, evidence);
  }

  return {
    leadingRank,
    coLeading,
    leadingCandidateIds,
    evidenceByCandidateId,
  };
}
