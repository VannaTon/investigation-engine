import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationEvidenceGroup } from "../types/investigation-evidence-group.js";
import type { InvestigationSignal } from "../types/investigation-signal.js";
import type { TraceNode } from "../types/trace-tree.js";

export class InvestigationSignalService {
  private collectTraceErrorChain(
    node: TraceNode,
    findingBySpan: Map<string, InvestigationFinding>,
    groupFindingIds: Set<string>,
    ancestorErrorFindingIds: string[],
    chainFindingIds: Set<string>,
  ): void {
    const key = `${node.traceId}:${node.spanId}`;
    const finding = findingBySpan.get(key);

    let nextAncestorErrorFindingIds = ancestorErrorFindingIds;

    if (finding && groupFindingIds.has(finding.id)) {
      if (ancestorErrorFindingIds.length > 0) {
        for (const ancestorId of ancestorErrorFindingIds) {
          chainFindingIds.add(ancestorId);
        }

        chainFindingIds.add(finding.id);
      }

      nextAncestorErrorFindingIds = [...ancestorErrorFindingIds, finding.id];
    }

    for (const child of node.children) {
      this.collectTraceErrorChain(
        child,
        findingBySpan,
        groupFindingIds,
        nextAncestorErrorFindingIds,
        chainFindingIds,
      );
    }
  }
  createCrossServiceFailureSignals(
    evidenceGroups: InvestigationEvidenceGroup[],
    findings: InvestigationFinding[],
  ): InvestigationSignal[] {
    const findingById = new Map(
      findings.map((finding) => [finding.id, finding]),
    );

    const signals: InvestigationSignal[] = [];

    for (const group of evidenceGroups) {
      const errorFindings = group.findingIds
        .map((findingId) => findingById.get(findingId))
        .filter(
          (finding): finding is InvestigationFinding =>
            finding !== undefined &&
            (finding.type === "log_error" || finding.type === "trace_error"),
        );

      const services = [
        ...new Set(
          errorFindings
            .map((finding) => finding.service)
            .filter((service): service is string => service !== undefined),
        ),
      ].sort();

      if (services.length < 2) {
        continue;
      }

      const findingIds = errorFindings.map((finding) => finding.id).sort();

      signals.push({
        id: `signal:cross_service_failure:${group.id}`,
        type: "cross_service_failure",
        evidenceGroupId: group.id,
        findingIds,
        services,
        message: `Error evidence was observed across ${services.length} services`,
      });
    }

    return signals;
  }

  createMultiSignalEvidenceSignals(
    evidenceGroups: InvestigationEvidenceGroup[],
  ): InvestigationSignal[] {
    const signals: InvestigationSignal[] = [];

    for (const group of evidenceGroups) {
      const findingTypes = [...group.findingTypes].sort();

      if (findingTypes.length < 2) {
        continue;
      }

      signals.push({
        id: `signal:multi_signal_evidence:${group.id}`,
        type: "multi_signal_evidence",
        evidenceGroupId: group.id,
        findingIds: [...group.findingIds].sort(),
        message: `This evidence group contains ${findingTypes.join(", ")} findings`,
      });
    }

    return signals;
  }

  createTraceFailureChainSignals(
    evidenceGroups: InvestigationEvidenceGroup[],
    findings: InvestigationFinding[],
    traces: TraceNode[],
  ): InvestigationSignal[] {
    const findingBySpan = new Map<string, InvestigationFinding>();

    for (const finding of findings) {
      if (finding.type === "trace_error" && finding.traceId && finding.spanId) {
        findingBySpan.set(`${finding.traceId}:${finding.spanId}`, finding);
      }
    }

    const signals: InvestigationSignal[] = [];

    for (const group of evidenceGroups) {
      const groupFindingIds = new Set(group.findingIds);

      for (const root of traces) {
        const chainFindingIds = new Set<string>();

        this.collectTraceErrorChain(
          root,
          findingBySpan,
          groupFindingIds,
          [],
          chainFindingIds,
        );

        if (chainFindingIds.size < 2) {
          continue;
        }

        const findingIds = [...chainFindingIds].sort();

        signals.push({
          id: `signal:trace_failure_chain:${group.id}:${root.traceId}`,
          type: "trace_failure_chain",
          evidenceGroupId: group.id,
          findingIds,
          traceId: root.traceId,
          message: `Error spans were observed across multiple levels of trace ${root.traceId}`,
        });
      }
    }

    return signals;
  }

  createSignals(
    evidenceGroups: InvestigationEvidenceGroup[],
    findings: InvestigationFinding[],
    traces: TraceNode[],
  ): InvestigationSignal[] {
    return [
      ...this.createCrossServiceFailureSignals(evidenceGroups, findings),

      ...this.createMultiSignalEvidenceSignals(evidenceGroups),

      ...this.createTraceFailureChainSignals(evidenceGroups, findings, traces),
    ];
  }
}
