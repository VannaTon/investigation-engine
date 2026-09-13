export type ErrorGroupStatus = "open" | "acknowledged" | "resolved";

export interface ErrorGroup {
  fingerprint: string;
  sample_message: string;
  normalized_message: string;
  occurrence_count: number;
  first_seen: string;
  last_seen: string;
  example_trace_id: string | null;
  status: ErrorGroupStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
}
