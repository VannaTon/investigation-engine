import type { LogLevel } from "./log-event.js";
export interface LogQuery {
  service?: string;
  level?: LogLevel;
  cursor?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  traceId?: string;
  fingerprint?: string;
}
