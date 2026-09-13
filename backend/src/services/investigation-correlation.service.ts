import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationCorrelation } from "../types/investigation-correlation.js";
import type {
  InvestigationIntegrityIssue,
  InvestigationIntegrityIssueType,
} from "../types/investigation-integrity-issue.js";

export class InvestigationCorrelationService {
  private buildTemporalServiceCorrelation(
    service: string,
    findings: InvestigationFinding[],
    windowMs: number,
  ): InvestigationCorrelation {
    const first = findings[0];
    const last = findings.at(-1);

    if (!first || !last) {
      throw new Error("Temporal correlation cluster cannot be empty.");
    }

    return {
      id: ["temporal_service", service, first.timestamp, last.timestamp].join(
        ":",
      ),
      type: "temporal_service",
      findingIds: findings.map((finding) => finding.id),
      service,
      message: `Multiple findings occurred on ${service} within ${windowMs / 1000} seconds`,
    };
  }

  createCorrelations(
    findings: InvestigationFinding[],
    integrityIssues: InvestigationIntegrityIssue[] = [],
  ): InvestigationCorrelation[] {
    return [
      ...this.createSameSpanCorrelations(findings, integrityIssues),
      ...this.createSameTraceCorrelations(findings, integrityIssues),
      ...this.createTemporalServiceCorrelations(findings),
    ];
  }
  createSameSpanCorrelations(
    findings: InvestigationFinding[],
    integrityIssues: InvestigationIntegrityIssue[] = [],
  ): InvestigationCorrelation[] {
    const groups = new Map<string, InvestigationFinding[]>();

    for (const finding of findings) {
      if (
        !finding.traceId ||
        !finding.spanId ||
        !this.isRelationshipAllowed(finding, "same_span", integrityIssues)
      ) {
        continue;
      }

      const key = `${finding.traceId}:${finding.spanId}`;

      const existing = groups.get(key);

      if (existing) {
        existing.push(finding);
      } else {
        groups.set(key, [finding]);
      }
    }

    const correlations: InvestigationCorrelation[] = [];

    for (const [key, groupedFindings] of groups) {
      if (groupedFindings.length < 2) {
        continue;
      }

      const firstFinding = groupedFindings[0];

      if (!firstFinding?.traceId || !firstFinding.spanId) {
        continue;
      }

      correlations.push({
        id: `same_span:${key}`,
        type: "same_span",
        findingIds: groupedFindings.map((finding) => finding.id),
        traceId: firstFinding.traceId,
        spanId: firstFinding.spanId,
        message: `Multiple findings reference span ${firstFinding.spanId}`,
      });
    }

    return correlations;
  }

  createSameTraceCorrelations(
    findings: InvestigationFinding[],
    integrityIssues: InvestigationIntegrityIssue[] = [],
  ): InvestigationCorrelation[] {
    const groups = new Map<string, InvestigationFinding[]>();

    for (const finding of findings) {
      if (
        !finding.traceId ||
        !this.isRelationshipAllowed(finding, "same_trace", integrityIssues)
      ) {
        continue;
      }

      const existing = groups.get(finding.traceId);

      if (existing) {
        existing.push(finding);
      } else {
        groups.set(finding.traceId, [finding]);
      }
    }

    const correlations: InvestigationCorrelation[] = [];

    for (const [traceId, groupedFindings] of groups) {
      if (groupedFindings.length < 2) {
        continue;
      }

      correlations.push({
        id: `same_trace:${traceId}`,
        type: "same_trace",
        findingIds: groupedFindings.map((finding) => finding.id),
        traceId,
        message: `Multiple findings occurred within trace ${traceId}`,
      });
    }

    return correlations;
  }

  private isRelationshipAllowed(
    finding: InvestigationFinding,
    correlationType: "same_span" | "same_trace",
    integrityIssues: InvestigationIntegrityIssue[],
  ): boolean {
    if (finding.type !== "log_error") {
      return true;
    }

    for (const issue of integrityIssues) {
      if (!this.issueMatchesFinding(issue, finding)) {
        continue;
      }

      if (this.issueBlocksCorrelation(issue.type, correlationType)) {
        return false;
      }
    }

    return true;
  }

  private issueBlocksCorrelation(
    issueType: InvestigationIntegrityIssueType,
    correlationType: "same_span" | "same_trace",
  ): boolean {
    if (correlationType === "same_span") {
      return (
        issueType === "service_span_mismatch" ||
        issueType === "missing_span_reference" ||
        issueType === "missing_trace_reference"
      );
    }

    if (correlationType === "same_trace") {
      return issueType === "missing_trace_reference";
    }

    return false;
  }

  private issueMatchesFinding(
    issue: InvestigationIntegrityIssue,
    finding: InvestigationFinding,
  ): boolean {
    return (
      finding.type === "log_error" &&
      issue.logTimestamp === finding.timestamp &&
      issue.service === finding.service &&
      issue.traceId === finding.traceId &&
      issue.spanId === finding.spanId
    );
  }

  createTemporalServiceCorrelations(
    findings: InvestigationFinding[],
    windowMs: number = 30_000,
  ): InvestigationCorrelation[] {
    const groupedByService = new Map<string, InvestigationFinding[]>();

    for (const finding of findings) {
      if (!finding.service) {
        continue;
      }

      const existing = groupedByService.get(finding.service);

      if (existing) {
        existing.push(finding);
      } else {
        groupedByService.set(finding.service, [finding]);
      }
    }

    const correlations: InvestigationCorrelation[] = [];

    for (const [service, serviceFindings] of groupedByService) {
      const sorted = [...serviceFindings].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      let cluster: InvestigationFinding[] = [];

      for (const finding of sorted) {
        if (cluster.length === 0) {
          cluster.push(finding);
          continue;
        }

        const clusterStart = cluster[0];

        if (!clusterStart) {
          cluster = [finding];
          continue;
        }

        const difference =
          new Date(finding.timestamp).getTime() -
          new Date(clusterStart.timestamp).getTime();

        if (difference <= windowMs) {
          cluster.push(finding);
          continue;
        }

        if (cluster.length >= 2) {
          correlations.push(
            this.buildTemporalServiceCorrelation(service, cluster, windowMs),
          );
        }

        cluster = [finding];
      }

      if (cluster.length >= 2) {
        correlations.push(
          this.buildTemporalServiceCorrelation(service, cluster, windowMs),
        );
      }
    }

    return correlations;
  }
}
