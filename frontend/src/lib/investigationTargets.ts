import type {
  InvestigationIntegrityIssue,
  LogEvent,
  TraceNode,
} from "../types/investigation";

function domToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function traceDomId(traceId: string): string {
  return `investigation-trace-${domToken(traceId)}`;
}

export function traceSpanDomId(traceId: string, spanId: string): string {
  return `investigation-span-${domToken(traceId)}-${domToken(spanId)}`;
}

export function logDomId(
  timestamp: string,
  service: string,
  index: number,
): string {
  return `investigation-log-${domToken(timestamp)}-${domToken(service)}-${index}`;
}

export function findTraceNode(
  traces: TraceNode[],
  traceId: string,
  spanId: string,
): TraceNode | undefined {
  const visit = (node: TraceNode): TraceNode | undefined => {
    if (node.traceId === traceId && node.spanId === spanId) return node;

    for (const child of node.children) {
      const match = visit(child);
      if (match) return match;
    }

    return undefined;
  };

  for (const trace of traces) {
    const match = visit(trace);
    if (match) return match;
  }

  return undefined;
}

export function findTraceRoot(
  traces: TraceNode[],
  traceId: string,
): TraceNode | undefined {
  return traces.find((trace) => trace.traceId === traceId);
}

export function findRelatedLogIndex(
  issue: InvestigationIntegrityIssue,
  logs: LogEvent[],
): number {
  if (!issue.logTimestamp) return -1;

  return logs.findIndex(
    (log) =>
      log.timestamp === issue.logTimestamp &&
      (issue.service === undefined || log.service === issue.service),
  );
}