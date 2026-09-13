import type {
  InvestigationCorrelation,
  InvestigationEvidenceGroup,
  InvestigationEvidenceRank,
  InvestigationFinding,
  InvestigationSignal,
} from "../types/investigation";

export interface EvidenceStoryFindingReference {
  id: string;
  finding?: InvestigationFinding;
  rank?: InvestigationEvidenceRank;
}

export interface EvidenceStoryCorrelationReference {
  id: string;
  correlation?: InvestigationCorrelation;
}

export interface EvidenceStoryThread {
  id: string;
  group: InvestigationEvidenceGroup;
  findings: EvidenceStoryFindingReference[];
  correlations: EvidenceStoryCorrelationReference[];
  signals: InvestigationSignal[];
}

export interface InvestigationEvidenceStory {
  threads: EvidenceStoryThread[];
  ungroupedFindings: EvidenceStoryFindingReference[];
}

function orderedFindingReferences(
  findingIds: readonly string[],
  ranks: readonly InvestigationEvidenceRank[],
  findingsById: ReadonlyMap<string, InvestigationFinding>,
  ranksByFindingId: ReadonlyMap<string, InvestigationEvidenceRank>,
): EvidenceStoryFindingReference[] {
  const allowedIds = new Set(findingIds);
  const orderedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const rank of ranks) {
    if (allowedIds.has(rank.findingId) && !seenIds.has(rank.findingId)) {
      orderedIds.push(rank.findingId);
      seenIds.add(rank.findingId);
    }
  }

  for (const findingId of findingIds) {
    if (!seenIds.has(findingId)) {
      orderedIds.push(findingId);
      seenIds.add(findingId);
    }
  }

  return orderedIds.map((id) => ({
    id,
    finding: findingsById.get(id),
    rank: ranksByFindingId.get(id),
  }));
}

export function buildInvestigationEvidenceStory(
  ranks: InvestigationEvidenceRank[],
  findings: InvestigationFinding[],
  evidenceGroups: InvestigationEvidenceGroup[],
  correlations: InvestigationCorrelation[],
  signals: InvestigationSignal[],
): InvestigationEvidenceStory {
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  const ranksByFindingId = new Map(ranks.map((rank) => [rank.findingId, rank]));
  const correlationsById = new Map(
    correlations.map((correlation) => [correlation.id, correlation]),
  );
  const groupedFindingIds = new Set(
    evidenceGroups.flatMap((group) => group.findingIds),
  );

  const threads = evidenceGroups.map((group) => ({
    id: group.id,
    group,
    findings: orderedFindingReferences(
      group.findingIds,
      ranks,
      findingsById,
      ranksByFindingId,
    ),
    correlations: group.correlationIds.map((id) => ({
      id,
      correlation: correlationsById.get(id),
    })),
    signals: signals.filter((signal) => signal.evidenceGroupId === group.id),
  }));

  const ungroupedFindingIds: string[] = [];
  const seenUngroupedIds = new Set<string>();
  for (const rank of ranks) {
    if (
      !groupedFindingIds.has(rank.findingId) &&
      !seenUngroupedIds.has(rank.findingId)
    ) {
      ungroupedFindingIds.push(rank.findingId);
      seenUngroupedIds.add(rank.findingId);
    }
  }
  for (const finding of findings) {
    if (
      !groupedFindingIds.has(finding.id) &&
      !seenUngroupedIds.has(finding.id)
    ) {
      ungroupedFindingIds.push(finding.id);
      seenUngroupedIds.add(finding.id);
    }
  }

  return {
    threads,
    ungroupedFindings: ungroupedFindingIds.map((id) => ({
      id,
      finding: findingsById.get(id),
      rank: ranksByFindingId.get(id),
    })),
  };
}
