import { createHash } from "node:crypto";

import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationCorrelation } from "../types/investigation-correlation.js";
import type { InvestigationEvidenceGroup } from "../types/investigation-evidence-group.js";

export class InvestigationEvidenceGroupService {
  createGroups(
    findings: InvestigationFinding[],
    correlations: InvestigationCorrelation[],
  ): InvestigationEvidenceGroup[] {
    const findingById = new Map(
      findings.map((finding) => [finding.id, finding]),
    );

    const adjacency = new Map<string, Set<string>>();

    for (const correlation of correlations) {
      const validFindingIds = correlation.findingIds.filter((id) =>
        findingById.has(id),
      );

      for (const findingId of validFindingIds) {
        if (!adjacency.has(findingId)) {
          adjacency.set(findingId, new Set());
        }

        for (const relatedId of validFindingIds) {
          if (relatedId !== findingId) {
            adjacency.get(findingId)?.add(relatedId);
          }
        }
      }
    }

    const visited = new Set<string>();
    const groups: InvestigationEvidenceGroup[] = [];

    for (const findingId of adjacency.keys()) {
      if (visited.has(findingId)) {
        continue;
      }

      const component = this.collectComponent(findingId, adjacency, visited);

      if (component.length < 2) {
        continue;
      }

      groups.push(this.buildGroup(component, findings, correlations));
    }

    return groups;
  }

  private collectComponent(
    startId: string,
    adjacency: Map<string, Set<string>>,
    visited: Set<string>,
  ): string[] {
    const stack = [startId];
    const component: string[] = [];

    while (stack.length > 0) {
      const current = stack.pop();

      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);
      component.push(current);

      const neighbors = adjacency.get(current);

      if (!neighbors) {
        continue;
      }

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }

    return component;
  }

  private buildGroup(
    findingIds: string[],
    findings: InvestigationFinding[],
    correlations: InvestigationCorrelation[],
  ): InvestigationEvidenceGroup {
    const findingSet = new Set(findingIds);

    const groupedFindings = findings.filter((finding) =>
      findingSet.has(finding.id),
    );

    const groupedCorrelations = correlations.filter((correlation) =>
      correlation.findingIds.some((id) => findingSet.has(id)),
    );

    const services = [
      ...new Set(
        groupedFindings
          .map((finding) => finding.service)
          .filter((service): service is string => service !== undefined),
      ),
    ].sort();

    const traceIds = [
      ...new Set(
        groupedFindings
          .map((finding) => finding.traceId)
          .filter((traceId): traceId is string => traceId !== undefined),
      ),
    ].sort();

    const findingCount = groupedFindings.length;
    const correlationCount = groupedCorrelations.length;

    const findingTypes = [
      ...new Set(groupedFindings.map((finding) => finding.type)),
    ].sort();

    const correlationTypes = [
      ...new Set(groupedCorrelations.map((correlation) => correlation.type)),
    ].sort();

    const sortedFindingsByTime = [...groupedFindings].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const firstFinding = sortedFindingsByTime[0];
    const lastFinding = sortedFindingsByTime.at(-1);

    if (!firstFinding || !lastFinding) {
      throw new Error("Evidence group must contain findings.");
    }

    const startedAt = firstFinding.timestamp;
    const endedAt = lastFinding.timestamp;

    const sortedFindingIds = [...findingIds].sort();

    const hash = createHash("sha256")
      .update(sortedFindingIds.join("|"))
      .digest("hex")
      .slice(0, 16);

    return {
      id: `evidence_group:${hash}`,

      findingIds: sortedFindingIds,

      correlationIds: groupedCorrelations
        .map((correlation) => correlation.id)
        .sort(),

      services,
      traceIds,

      findingCount,
      correlationCount,

      findingTypes,
      correlationTypes,

      startedAt,
      endedAt,

      message: `${groupedFindings.length} related findings across ${services.length} services`,
    };
  }
}
