import { Link2, ShieldCheck, TriangleAlert } from "lucide-react";
import { InvestigationDetailSection } from "./InvestigationDetailSection";
import {
  findRelatedLogIndex,
  findTraceNode,
  findTraceRoot,
  logDomId,
  traceDomId,
  traceSpanDomId,
} from "../lib/investigationTargets";
import type {
  InvestigationIntegrityIssue,
  InvestigationIntegrityIssueType,
  LogEvent,
  TraceNode,
} from "../types/investigation";

const issueTypeLabels: Record<InvestigationIntegrityIssueType, string> = {
  missing_trace_reference: "Missing trace reference",
  missing_span_reference: "Missing span reference",
  service_span_mismatch: "Service and span mismatch",
};

interface IntegrityIssuesProps {
  issues: InvestigationIntegrityIssue[];
  logs: LogEvent[];
  traces: TraceNode[];
  grouped?: boolean;
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  onOpenTelemetry?: () => void;
  onOpenTrace?: () => void;
}

export function IntegrityIssues({
  issues,
  logs,
  traces,
  grouped = false,
  detailsOpen,
  onDetailsOpenChange,
  onOpenTelemetry,
  onOpenTrace,
}: IntegrityIssuesProps) {
  const hasIssues = issues.length > 0;

  return (
    <InvestigationDetailSection
      id="integrity"
      eyebrow="Data quality"
      title={hasIssues ? "Integrity issues" : "Telemetry references verified"}
      description={
        hasIssues
          ? "Some telemetry references could not be structurally verified."
          : "No inconsistent trace or span references were reported."
      }
      count={issues.length}
      Icon={hasIssues ? TriangleAlert : ShieldCheck}
      actionLabel={hasIssues ? "Review" : "View check"}
      drawerTitle={hasIssues ? "Telemetry reference issues" : "Telemetry references verified"}
      drawerDescription={
        hasIssues
          ? "Reference inconsistencies affect data quality; they do not invalidate the incident."
          : "Reference checks reported by the investigation response."
      }
      warning={hasIssues}
      grouped={grouped}
      open={detailsOpen}
      onOpenChange={onDetailsOpenChange}
      preview={
        hasIssues ? (
          <p className="break-words text-xs [overflow-wrap:anywhere]">
            <span className="font-extrabold text-incident">{issueTypeLabels[issues[0].type]}:</span>{" "}
            <span className="font-semibold text-ink">{issues[0].message}</span>
            {issues.length > 1 ? <span className="text-slate"> · +{issues.length - 1} more</span> : null}
          </p>
        ) : undefined
      }
    >
      {!hasIssues ? (
        <p className="px-5 py-4 text-xs leading-5 text-slate sm:px-6">
          Telemetry references were checked for this investigation. No inconsistent
          trace or span references were reported.
        </p>
      ) : (
        <ul className="divide-y divide-steel">
          {issues.map((issue) => {
            const logIndex = findRelatedLogIndex(issue, logs);
            const log = logIndex >= 0 ? logs[logIndex] : undefined;
            const span =
              issue.traceId && issue.spanId
                ? findTraceNode(traces, issue.traceId, issue.spanId)
                : undefined;
            const traceRoot = issue.traceId
              ? findTraceRoot(traces, issue.traceId)
              : undefined;

            return (
              <li key={issue.id} className="px-5 py-4 sm:px-6">
                <div className="flex items-start gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-incident/30 bg-incident/[0.06] text-incident">
                    <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-extrabold text-ink">
                      {issueTypeLabels[issue.type]}
                    </h3>
                    <p className="mt-1 break-words text-sm leading-5 text-ink [overflow-wrap:anywhere]">
                      {issue.message}
                    </p>

                    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
                      {issue.service && (
                        <div>
                          <dt className="font-bold uppercase tracking-[0.1em] text-slate">Log service</dt>
                          <dd className="mt-0.5 font-mono text-ink">{issue.service}</dd>
                        </div>
                      )}
                      {issue.traceId && (
                        <div>
                          <dt className="font-bold uppercase tracking-[0.1em] text-slate">Trace</dt>
                          <dd className="mt-0.5 break-all font-mono text-ink">{issue.traceId}</dd>
                        </div>
                      )}
                      {issue.spanId && (
                        <div>
                          <dt className="font-bold uppercase tracking-[0.1em] text-slate">Span</dt>
                          <dd className="mt-0.5 break-all font-mono text-ink">{issue.spanId}</dd>
                        </div>
                      )}
                    </dl>

                    <div className="mt-3 flex flex-wrap gap-3">
                      {log && (
                        <a
                          href={`#${logDomId(log.timestamp, log.service, logIndex)}`}
                          onClick={onOpenTelemetry}
                          className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate underline decoration-steel underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                          View related log
                        </a>
                      )}
                      {span && issue.traceId && issue.spanId && (
                        <a
                          href={`#${traceSpanDomId(issue.traceId, issue.spanId)}`}
                          onClick={onOpenTrace}
                          className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate underline decoration-steel underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                          View referenced span
                        </a>
                      )}
                      {!span && traceRoot && issue.traceId && (
                        <a
                          href={`#${traceDomId(issue.traceId)}`}
                          onClick={onOpenTrace}
                          className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate underline decoration-steel underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                          View available trace
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </InvestigationDetailSection>
  );
}