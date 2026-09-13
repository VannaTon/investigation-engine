import type { InvestigationFinding } from "../types/investigation-finding.js";

import type { InvestigationEvidenceGroup } from "../types/investigation-evidence-group.js";

import type { InvestigationSignal } from "../types/investigation-signal.js";

import type { InvestigationCauseCandidate } from "../types/investigation-cause-candidate.js";

export class InvestigationCauseCandidateService {
  createCandidates(
    evidenceGroups: InvestigationEvidenceGroup[],
    findings: InvestigationFinding[],
    signals: InvestigationSignal[],
  ): InvestigationCauseCandidate[] {
    const findingById = new Map(
      findings.map((finding) => [finding.id, finding]),
    );

    const candidates: InvestigationCauseCandidate[] = [];

    for (const group of evidenceGroups) {
      const failureFindings = group.findingIds
        .map((id) => findingById.get(id))
        .filter(
          (finding): finding is InvestigationFinding =>
            finding !== undefined &&
            finding.service !== undefined &&
            (finding.type === "log_error" || finding.type === "trace_error"),
        );

      const findingsByService = new Map<string, InvestigationFinding[]>();

      for (const finding of failureFindings) {
        const service = finding.service;

        if (!service) {
          continue;
        }

        const existing = findingsByService.get(service) ?? [];

        existing.push(finding);

        findingsByService.set(service, existing);
      }

      for (const [service, serviceFindings] of findingsByService) {
        candidates.push(
          this.buildCandidate(group, service, serviceFindings, signals),
        );
      }
    }

    return candidates.sort((a, b) => a.id.localeCompare(b.id));
  }

  private buildCandidate(
    group: InvestigationEvidenceGroup,
    service: string,
    findings: InvestigationFinding[],
    signals: InvestigationSignal[],
  ): InvestigationCauseCandidate {
    const findingIds = findings.map((finding) => finding.id).sort();

    const findingIdSet = new Set(findingIds);

    const signalIds = signals
      .filter(
        (signal) =>
          signal.evidenceGroupId === group.id &&
          signal.findingIds.some((id) => findingIdSet.has(id)),
      )
      .map((signal) => signal.id)
      .sort();

    const traceIds = [
      ...new Set(
        findings
          .map((finding) => finding.traceId)
          .filter((traceId): traceId is string => traceId !== undefined),
      ),
    ].sort();

    const sortedByTime = [...findings].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const firstFinding = sortedByTime[0];
    const lastFinding = sortedByTime[sortedByTime.length - 1];

    if (!firstFinding || !lastFinding) {
      throw new Error(
        `Cannot build cause candidate for ${service} without findings`,
      );
    }

    const reasons: string[] = [
      `${findings.length} failure finding(s) observed on ${service}`,
    ];

    if (signalIds.length > 0) {
      reasons.push(
        `${signalIds.length} structural signal(s) reference this failure evidence`,
      );
    }

    return {
      id: `cause_candidate:${group.id}:${service}`,

      service,

      findingIds,
      signalIds,
      traceIds,

      startedAt: firstFinding.timestamp,
      endedAt: lastFinding.timestamp,

      reasons,
    };
  }
}
