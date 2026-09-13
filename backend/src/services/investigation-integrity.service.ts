import type { LogEvent } from "../types/log-event.js";
import type { TraceNode } from "../types/trace-tree.js";
import type { InvestigationIntegrityIssue } from "../types/investigation-integrity-issue.js";

export class InvestigationIntegrityService {
  validateLogs(
    logs: LogEvent[],
    traces: TraceNode[],
  ): InvestigationIntegrityIssue[] {
    const spanByKey = new Map<string, TraceNode>();

    const traceIds = new Set<string>();

    for (const root of traces) {
      traceIds.add(root.traceId);

      this.indexTrace(root, spanByKey);
    }

    const issues: InvestigationIntegrityIssue[] = [];

    for (const log of logs) {
      if (!log.traceId || !log.spanId) {
        continue;
      }

      if (!traceIds.has(log.traceId)) {
        issues.push({
          id: `integrity:missing_trace_reference:${log.traceId}:${log.timestamp}`,
          type: "missing_trace_reference",
          message: `Log references trace ${log.traceId}, but that trace was not found`,
          logTimestamp: log.timestamp,
          service: log.service,
          traceId: log.traceId,
          spanId: log.spanId,
        });

        continue;
      }

      const key = `${log.traceId}:${log.spanId}`;
      const span = spanByKey.get(key);

      if (!span) {
        issues.push({
          id: `integrity:missing_span_reference:${log.traceId}:${log.spanId}:${log.timestamp}`,
          type: "missing_span_reference",
          message: `Log references span ${log.spanId}, but that span was not found in trace ${log.traceId}`,
          logTimestamp: log.timestamp,
          service: log.service,
          traceId: log.traceId,
          spanId: log.spanId,
        });

        continue;
      }

      if (span.service !== log.service) {
        issues.push({
          id: `integrity:service_span_mismatch:${log.traceId}:${log.spanId}:${log.timestamp}`,
          type: "service_span_mismatch",
          message: `Log service ${log.service} does not match referenced span service ${span.service}`,
          logTimestamp: log.timestamp,
          service: log.service,
          traceId: log.traceId,
          spanId: log.spanId,
        });
      }
    }

    return issues;
  }
  private indexTrace(node: TraceNode, spanByKey: Map<string, TraceNode>): void {
    spanByKey.set(`${node.traceId}:${node.spanId}`, node);

    for (const child of node.children) {
      this.indexTrace(child, spanByKey);
    }
  }
}
