import type { MetricEvent } from "../types/metric-event.js";
import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { LogEvent } from "../types/log-event.js";
import type { TraceNode } from "../types/trace-tree.js";
import type { InvestigationSummary } from "../types/investigation-finding.js";
import { InvestigationSeverityService } from "./investigation-severity.service.js";

export class InvestigationFindingService {
  constructor(private readonly severityService: InvestigationSeverityService) {}
  private createId(parts: string[]): string {
    return parts.join(":");
  }

  private matchesThreshold(
    value: number,
    threshold: number,
    operator: ">" | ">=" | "<" | "<=",
  ): boolean {
    switch (operator) {
      case ">":
        return value > threshold;

      case ">=":
        return value >= threshold;

      case "<":
        return value < threshold;

      case "<=":
        return value <= threshold;
    }
  }

  createMetricFindings(
    metrics: MetricEvent[],
    threshold: number,
    metricName: string,
    operator: ">" | ">=" | "<" | "<=",
  ): InvestigationFinding[] {
    return metrics
      .filter(
        (metric) =>
          metric.name === metricName &&
          this.matchesThreshold(metric.value, threshold, operator),
      )
      .map((metric) => ({
        id: this.createId([
          "metric_threshold",
          metric.service,
          metric.name,
          metric.timestamp,
        ]),
        type: "metric_threshold",
        severity: this.severityService.forMetricThreshold(),
        timestamp: metric.timestamp,
        message: `${metric.name} reached ${metric.value} (threshold ${operator} ${threshold})`,
        service: metric.service,
      }));
  }

  createLogFindings(logs: LogEvent[]): InvestigationFinding[] {
    return logs
      .filter((log) => log.level === "error")
      .map((log) => ({
        id: this.createId([
          "log_error",
          log.service,
          log.timestamp,
          log.traceId ?? "no-trace",
          log.spanId ?? "no-span",
        ]),
        type: "log_error",
        severity: this.severityService.forLog(log.level),
        timestamp: log.timestamp,
        message: log.message,
        service: log.service,
        ...(log.traceId !== undefined && {
          traceId: log.traceId,
        }),
        ...(log.spanId !== undefined && {
          spanId: log.spanId,
        }),
      }));
  }

  createTraceFindings(traces: TraceNode[]): InvestigationFinding[] {
    const findings: InvestigationFinding[] = [];

    const visit = (node: TraceNode) => {
      if (node.status === "error") {
        findings.push({
          id: this.createId(["trace_error", node.traceId, node.spanId]),
          type: "trace_error",
          severity: this.severityService.forTrace(node.status),
          timestamp: node.startTime,
          message: `Trace error in ${node.service}: ${node.operation}`,
          service: node.service,
          traceId: node.traceId,
          spanId: node.spanId,
        });
      }

      for (const child of node.children) {
        visit(child);
      }
    };

    for (const root of traces) {
      visit(root);
    }

    return findings;
  }

  createSummary(
    findings: InvestigationFinding[],
    traces: TraceNode[],
  ): InvestigationSummary {
    const services = new Set<string>();

    const visit = (node: TraceNode) => {
      services.add(node.service);

      for (const child of node.children) {
        visit(child);
      }
    };

    for (const root of traces) {
      visit(root);
    }

    const errorSpans = findings.filter(
      (finding) => finding.type === "trace_error",
    ).length;

    const metricAnomalies = findings.filter(
      (finding) => finding.type === "metric_threshold",
    ).length;

    const logErrors = findings.filter(
      (finding) => finding.type === "log_error",
    ).length;

    return {
      servicesInvolved: [...services],
      errorSpans,
      metricAnomalies,
      logErrors,
    };
  }
}
