import type { LogEvent } from "../types/investigation";

export interface ExactSpanReference {
  traceId: string;
  spanId: string;
}

export interface IndexedExactSpanLog {
  index: number;
  log: LogEvent;
}

export function exactSpanLogKey(traceId: string, spanId: string): string {
  return `${traceId.length}:${traceId}${spanId}`;
}

export function buildExactSpanLogLookup(
  logs: LogEvent[],
): ReadonlyMap<string, readonly IndexedExactSpanLog[]> {
  const mutableLookup = new Map<string, IndexedExactSpanLog[]>();

  logs.forEach((log, index) => {
    if (!log.traceId || !log.spanId) return;

    const key = exactSpanLogKey(log.traceId, log.spanId);
    const existing = mutableLookup.get(key);
    const indexedLog = { index, log };
    if (existing) {
      existing.push(indexedLog);
    } else {
      mutableLookup.set(key, [indexedLog]);
    }
  });

  return mutableLookup;
}

export function findExactSpanLogs(
  lookup: ReadonlyMap<string, readonly IndexedExactSpanLog[]>,
  reference: ExactSpanReference,
): readonly IndexedExactSpanLog[] {
  return lookup.get(exactSpanLogKey(reference.traceId, reference.spanId)) ?? [];
}
