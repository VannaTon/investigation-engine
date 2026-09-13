import type { LogEvent } from "./log-event.js";

export interface LogQueryResult {
  data: LogEvent[];
  hasMore: boolean;
  nextCursor?: string;
}
