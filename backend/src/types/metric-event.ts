export interface MetricEvent {
  timestamp: string;
  service: string;
  name: string;
  type: "counter" | "gauge";
  value: number;
  unit?: string;
  metadata?: Record<string, unknown>;
}
