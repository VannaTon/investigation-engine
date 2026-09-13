import type { HistogramMetricEvent } from "./histogram-metric-event.js";

export interface HistogramMetricQueryResult {
  data: HistogramMetricEvent[];
  hasMore: boolean;
  nextCursor?: string;
}
