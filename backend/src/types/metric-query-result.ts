import type { MetricEvent } from "./metric-event.js";

export interface MetricQueryResult {
  data: MetricEvent[];
  hasMore: boolean;
  nextCursor?: string;
}
