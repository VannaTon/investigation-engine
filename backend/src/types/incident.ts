import type { TraceNode } from "../types/trace-tree.js";
import type { LogQueryResult } from "../types/log-query-result.js";

export interface Incident {
  trace: TraceNode[];
  logs: LogQueryResult;
}
