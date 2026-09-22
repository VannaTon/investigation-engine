import type {
  InvestigationCorrelation,
  InvestigationCorrelationType,
  InvestigationEvidenceGroup,
} from "../types/investigation";

export interface EvidenceGroupCorrelationReference {
  id: string;
  correlation?: InvestigationCorrelation;
}

export const correlationTypeLabels: Record<
  InvestigationCorrelationType,
  string
> = {
  same_span: "Same step (span)",
  same_trace: "Same request path (trace)",
  temporal_service: "Same service and time window",
};

export function buildCorrelationLookup(
  correlations: InvestigationCorrelation[],
): ReadonlyMap<string, InvestigationCorrelation> {
  return new Map(
    correlations.map((correlation) => [correlation.id, correlation]),
  );
}

export function resolveEvidenceGroupCorrelations(
  group: InvestigationEvidenceGroup,
  correlationsById: ReadonlyMap<string, InvestigationCorrelation>,
): EvidenceGroupCorrelationReference[] {
  return group.correlationIds.map((id) => ({
    id,
    correlation: correlationsById.get(id),
  }));
}
