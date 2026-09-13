export interface HistogramMetricEvent {
  timestamp: string;
  service: string;
  name: string;
  type: "histogram";
  unit?: string;

  temporality: "delta" | "cumulative";
  /** Exact UInt64 decimal representation. */
  count: string;
  sum?: number;
  min?: number;
  max?: number;
  /** Exact UInt64 decimal representations, one per explicit bucket. */
  bucketCounts: string[];
  explicitBounds: number[];

  metadata?: Record<string, unknown>;
}
