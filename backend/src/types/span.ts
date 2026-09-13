export type SpanStatus = "ok" | "error";

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  service: string;
  operation: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  status: SpanStatus;
  metadata?: Record<string, unknown>;
}
