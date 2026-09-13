import type {
  InvestigationCorrelation,
  InvestigationFinding,
} from "../types/investigation";

export interface CorrelationFindingReference {
  id: string;
  finding?: InvestigationFinding;
}

export function findingDomId(findingId: string): string {
  let hash = 2166136261;

  for (const character of findingId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  const readable = findingId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56);

  return `finding-${readable || "item"}-${(hash >>> 0).toString(36)}`;
}

export function signalDomId(signalId: string): string {
  let hash = 2166136261;

  for (const character of signalId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  const readable = signalId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56);

  return `signal-${readable || "item"}-${(hash >>> 0).toString(36)}`;
}
export function buildFindingLookup(
  findings: InvestigationFinding[],
): ReadonlyMap<string, InvestigationFinding> {
  return new Map(findings.map((finding) => [finding.id, finding]));
}

export function resolveFindingIds(
  findingIds: string[],
  findingsById: ReadonlyMap<string, InvestigationFinding>,
): CorrelationFindingReference[] {
  return findingIds.map((id) => ({
    id,
    finding: findingsById.get(id),
  }));
}

export function resolveCorrelationFindings(
  correlation: InvestigationCorrelation,
  findingsById: ReadonlyMap<string, InvestigationFinding>,
): CorrelationFindingReference[] {
  return resolveFindingIds(correlation.findingIds, findingsById);
}


