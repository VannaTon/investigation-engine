import type { ErrorGroup } from "./error-group.js";
import type { LogQueryResult } from "./log-query-result.js";
import type { TraceNode } from "./trace-tree.js";
import type { MetricEvent } from "./metric-event.js";
import type { LogEvent } from "./log-event.js";
import type { Alert } from "./alert.js";

export interface Investigation {
  group: ErrorGroup;
  logs: LogQueryResult;
  traces: TraceNode[];
  metrics: MetricEvent[];
}

export type InvestigationTimelineItem =
  | {
      timestamp: string;
      type: "metric";
      data: MetricEvent;
    }
  | {
      timestamp: string;
      type: "log";
      data: LogEvent;
    }
  | {
      timestamp: string;
      type: "alert_fired";
      data: {
        alertId: string;
        ruleId: string;
        title: string;
        message: string;
      };
    }
  | {
      timestamp: string;
      type: "alert_resolved";
      data: {
        alertId: string;
        ruleId: string;
        title: string;
      };
    };
