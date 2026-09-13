import {
  buildExactSpanLogLookup,
  findExactSpanLogs,
  type ExactSpanReference,
  type IndexedExactSpanLog,
} from "./exactSpanLogs";
import type {
  InvestigationCorrelation,
  InvestigationEvidenceGroup,
  InvestigationEvidenceRank,
  InvestigationFinding,
  InvestigationSignal,
  LogEvent,
  TraceNode,
} from "../types/investigation";

export interface FindingEvidenceReviewInput {
  findings: InvestigationFinding[];
  evidenceRanks: InvestigationEvidenceRank[];
  evidenceGroups: InvestigationEvidenceGroup[];
  correlations: InvestigationCorrelation[];
  signals: InvestigationSignal[];
  logs: LogEvent[];
  traces: TraceNode[];
}

export interface FindingEvidenceReview {
  finding: InvestigationFinding;
  rank?: InvestigationEvidenceRank;
  priority?: number;
  evidenceGroups: InvestigationEvidenceGroup[];
  correlations: InvestigationCorrelation[];
  signals: InvestigationSignal[];
  exactSpanReference?: ExactSpanReference;
  exactSpan?: TraceNode;
  exactSpanLogs: readonly IndexedExactSpanLog[];
}

function findExactSpan(
  traces: TraceNode[],
  reference: ExactSpanReference,
): TraceNode | undefined {
  for (const trace of traces) {
    if (
      trace.traceId === reference.traceId &&
      trace.spanId === reference.spanId
    ) {
      return trace;
    }

    const match = findExactSpan(trace.children, reference);
    if (match) return match;
  }

  return undefined;
}

export function buildFindingEvidenceReview(
  findingId: string,
  input: FindingEvidenceReviewInput,
): FindingEvidenceReview | null {
  const finding = input.findings.find((item) => item.id === findingId);
  if (!finding) return null;

  const rankIndex = input.evidenceRanks.findIndex(
    (rank) => rank.findingId === finding.id,
  );
  const exactSpanReference =
    finding.traceId && finding.spanId
      ? {
          traceId: finding.traceId,
          spanId: finding.spanId,
        }
      : undefined;
  const exactSpanLogLookup = buildExactSpanLogLookup(input.logs);

  return {
    finding,
    ...(rankIndex >= 0
      ? {
          rank: input.evidenceRanks[rankIndex],
          priority: rankIndex + 1,
        }
      : {}),
    evidenceGroups: input.evidenceGroups.filter((group) =>
      group.findingIds.includes(finding.id),
    ),
    correlations: input.correlations.filter((correlation) =>
      correlation.findingIds.includes(finding.id),
    ),
    signals: input.signals.filter((signal) =>
      signal.findingIds.includes(finding.id),
    ),
    ...(exactSpanReference
      ? {
          exactSpanReference,
          exactSpan: findExactSpan(input.traces, exactSpanReference),
          exactSpanLogs: findExactSpanLogs(
            exactSpanLogLookup,
            exactSpanReference,
          ),
        }
      : {
          exactSpanLogs: [],
        }),
  };
}
