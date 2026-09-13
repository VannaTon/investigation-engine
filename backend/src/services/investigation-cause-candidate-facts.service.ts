import type {
  InvestigationFinding,
  InvestigationFindingSeverity,
} from "../types/investigation-finding.js";

import type {
  InvestigationSignal,
  InvestigationSignalType,
} from "../types/investigation-signal.js";
import type {
  InvestigationCorrelation,
  InvestigationCorrelationType,
} from "../types/investigation-correlation.js";
import type { InvestigationCauseCandidate } from "../types/investigation-cause-candidate.js";

import type { InvestigationCauseCandidateFacts } from "../types/investigation-cause-candidate-facts.js";

import type { TraceNode } from "../types/trace-tree.js";

export class InvestigationCauseCandidateFactsService {
  createFacts(
    candidates: InvestigationCauseCandidate[],
    findings: InvestigationFinding[],
    correlations: InvestigationCorrelation[],
    signals: InvestigationSignal[],
    traces: TraceNode[],
  ): InvestigationCauseCandidateFacts[] {
    const findingById = new Map(
      findings.map((finding) => [finding.id, finding]),
    );

    const signalById = new Map(signals.map((signal) => [signal.id, signal]));

    const spanByKey = new Map<string, TraceNode>();

    for (const root of traces) {
      this.indexTrace(root, spanByKey);
    }

    const facts = candidates.map((candidate) => {
      const candidateFindings = candidate.findingIds
        .map((id) => findingById.get(id))
        .filter(
          (finding): finding is InvestigationFinding => finding !== undefined,
        );
      const candidateFindingIds = new Set(candidate.findingIds);

      const correlationTypes = [
        ...new Set(
          correlations
            .filter((correlation) =>
              correlation.findingIds.some((findingId) =>
                candidateFindingIds.has(findingId),
              ),
            )
            .map((correlation) => correlation.type),
        ),
      ].sort() as InvestigationCorrelationType[];

      if (candidateFindings.length === 0) {
        throw new Error(`Cause candidate ${candidate.id} has no findings`);
      }

      const logErrorCount = candidateFindings.filter(
        (finding) => finding.type === "log_error",
      ).length;

      const traceErrorFindings = candidateFindings.filter(
        (finding) => finding.type === "trace_error",
      );

      const signalTypes = [
        ...new Set(
          candidate.signalIds
            .map((id) => signalById.get(id)?.type)
            .filter(
              (type): type is InvestigationSignalType => type !== undefined,
            ),
        ),
      ].sort();

      const supportDiversity = correlationTypes.length + signalTypes.length;

      let observedLeafErrorSpanCount = 0;
      let observedErrorAncestorSpanCount = 0;

      for (const finding of traceErrorFindings) {
        if (!finding.traceId || !finding.spanId) {
          continue;
        }

        const span = spanByKey.get(`${finding.traceId}:${finding.spanId}`);

        if (!span) {
          continue;
        }

        if (span.children.length === 0) {
          observedLeafErrorSpanCount++;
        }

        if (this.hasErrorDescendant(span)) {
          observedErrorAncestorSpanCount++;
        }
      }

      return {
        candidateId: candidate.id,
        service: candidate.service,

        failureFindingCount: candidateFindings.length,

        logErrorCount,

        traceErrorCount: traceErrorFindings.length,

        highestSeverity: this.getHighestSeverity(candidateFindings),

        traceCount: candidate.traceIds.length,

        correlationTypes,
        signalTypes,

        supportDiversity,

        observedLeafErrorSpanCount,
        observedErrorAncestorSpanCount,
      };
    });

    return facts.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  }

  private getHighestSeverity(
    findings: InvestigationFinding[],
  ): InvestigationFindingSeverity {
    let highest: InvestigationFindingSeverity = "info";

    for (const finding of findings) {
      if (
        this.getSeverityRank(finding.severity) > this.getSeverityRank(highest)
      ) {
        highest = finding.severity;
      }
    }

    return highest;
  }

  private getSeverityRank(severity: InvestigationFindingSeverity): number {
    switch (severity) {
      case "critical":
        return 3;

      case "high":
        return 2;

      case "warning":
        return 1;

      case "info":
        return 0;
    }
  }

  private indexTrace(node: TraceNode, spanByKey: Map<string, TraceNode>): void {
    spanByKey.set(`${node.traceId}:${node.spanId}`, node);

    for (const child of node.children) {
      this.indexTrace(child, spanByKey);
    }
  }

  private hasErrorDescendant(node: TraceNode): boolean {
    for (const child of node.children) {
      if (child.status === "error") {
        return true;
      }

      if (this.hasErrorDescendant(child)) {
        return true;
      }
    }

    return false;
  }
}
