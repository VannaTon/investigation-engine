import { useEffect } from "react";
import { Database, Gauge, ScrollText } from "lucide-react";
import { InvestigationDetailSection } from "./InvestigationDetailSection";
import { formatMetric, formatTime, parseTimestamp } from "../lib/formatters";
import { logDomId } from "../lib/investigationTargets";
import { hashTargetId } from "../lib/investigationReviewLocation";
import type { ExactSpanReference } from "../lib/exactSpanLogs";
import type { LogEvent, MetricEvent } from "../types/investigation";

interface EvidenceProps {
  metrics: MetricEvent[];
  logs: LogEvent[];
  grouped?: boolean;
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  focusedExactSpan?: ExactSpanReference | null;
}

function Metadata({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata) return null;

  const entries = Object.entries(metadata).filter(
    ([, value]) =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean",
  );

  if (entries.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="max-w-full break-words rounded bg-canvas px-1.5 py-0.5 font-mono text-[0.65rem] text-slate [overflow-wrap:anywhere]"
        >
          {key}={String(value)}
        </span>
      ))}
    </div>
  );
}

function EvidenceHeader({
  id,
  icon: Icon,
  eyebrow,
  title,
  count,
}: {
  id: string;
  icon: typeof Gauge;
  eyebrow: string;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-steel px-5 py-4">
      <div>
        <p className="flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-slate">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {eyebrow}
        </p>
        <h2 id={id} className="mt-1 text-base font-extrabold tracking-tight text-ink">
          {title}
        </h2>
      </div>
      <span className="rounded-md bg-canvas px-2 py-1 font-mono text-xs font-bold text-slate">
        {count}
      </span>
    </div>
  );
}

export function Evidence({
  metrics,
  logs,
  grouped = false,
  detailsOpen,
  onDetailsOpenChange,
  focusedExactSpan,
}: EvidenceProps) {
  const latestErrorLog = [...logs]
    .filter((log) => log.level === "error")
    .sort(
      (left, right) =>
        parseTimestamp(right.timestamp).getTime() -
        parseTimestamp(left.timestamp).getTime(),
    )[0];
  const focusedLogCount = focusedExactSpan
    ? logs.filter(
        (log) =>
          log.traceId === focusedExactSpan.traceId &&
          log.spanId === focusedExactSpan.spanId,
      ).length
    : 0;
  useEffect(() => {
    if (!detailsOpen || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const scrollToReferencedLog = () => {
      const targetId = hashTargetId(window.location.hash);
      if (!targetId?.startsWith("investigation-log-")) return;
      window.requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ block: "center" });
      });
    };

    scrollToReferencedLog();
    window.addEventListener("hashchange", scrollToReferencedLog);
    return () => window.removeEventListener("hashchange", scrollToReferencedLog);
  }, [detailsOpen]);

  return (
    <InvestigationDetailSection
      id="telemetry"
      eyebrow="Supporting observations"
      title="Telemetry"
      description={`${metrics.length} ${metrics.length === 1 ? "metric" : "metrics"} · ${logs.length} ${logs.length === 1 ? "log" : "logs"}.`}
      count={metrics.length + logs.length}
      Icon={Database}
      actionLabel="View all telemetry"
      drawerDescription="Complete metric readings and log records captured in the investigation window."
      grouped={grouped}
      open={detailsOpen}
      onOpenChange={onDetailsOpenChange}
      preview={
        latestErrorLog ? (
          <p className="flex min-w-0 items-center gap-2 text-xs">
            <span className="shrink-0 font-bold uppercase tracking-[0.08em] text-incident">Latest error</span>
            <span className="truncate font-semibold text-ink">{latestErrorLog.message}</span>
            <span className="shrink-0 font-mono text-[0.65rem] text-slate">{latestErrorLog.service}</span>
          </p>
        ) : undefined
      }
    >
      <div className="space-y-4 p-4 sm:p-5">
        {focusedExactSpan && (
          <div className="rounded-lg border border-ink bg-canvas px-4 py-3" role="status">
            <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-slate">
              Exact span selection
            </p>
            <p className="mt-1 text-sm font-extrabold text-ink">
              {focusedLogCount} {focusedLogCount === 1 ? "log matches" : "logs match"} the selected trace and span.
            </p>
            <p className="mt-1 break-all font-mono text-[0.65rem] leading-5 text-slate">
              trace {focusedExactSpan.traceId} · span {focusedExactSpan.spanId}
            </p>
          </div>
        )}

        <section className="overflow-hidden rounded-lg border border-steel bg-surface" aria-labelledby="metrics-heading">
          <EvidenceHeader
            id="metrics-heading"
            icon={Gauge}
            eyebrow="Supporting telemetry"
            title="Metrics"
            count={metrics.length}
          />
          {metrics.length > 0 ? (
            <ul className="divide-y divide-steel">
              {metrics.map((metric, index) => (
                <li key={`${metric.timestamp}-${metric.name}-${index}`} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-mono text-sm font-extrabold text-ink [overflow-wrap:anywhere]">
                        {metric.name}
                      </p>
                      <p className="mt-1 break-words font-mono text-xs text-slate [overflow-wrap:anywhere]">
                        {metric.service} · {metric.type}
                      </p>
                    </div>
                    <p className="font-mono text-xl font-extrabold tabular-nums text-ink">
                      {formatMetric(metric.value, metric.unit)}
                    </p>
                  </div>
                  <time dateTime={metric.timestamp} className="mt-2 block font-mono text-[0.68rem] tabular-nums text-slate">
                    {formatTime(metric.timestamp)}
                  </time>
                  <Metadata metadata={metric.metadata} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-slate">
              No metric readings found in this investigation window.
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-lg border border-steel bg-surface" aria-labelledby="logs-heading">
          <EvidenceHeader
            id="logs-heading"
            icon={ScrollText}
            eyebrow="Supporting telemetry"
            title="Logs"
            count={logs.length}
          />
          {logs.length > 0 ? (
            <ul className="divide-y divide-steel">
              {logs.map((log, index) => {
                const focused = Boolean(
                  focusedExactSpan &&
                    log.traceId === focusedExactSpan.traceId &&
                    log.spanId === focusedExactSpan.spanId,
                );

                return (
                  <li
                    id={logDomId(log.timestamp, log.service, index)}
                    key={`${log.timestamp}-${log.message}-${index}`}
                    className={`scroll-mt-4 px-5 py-4 target:bg-canvas target:ring-2 target:ring-inset target:ring-ink ${
                      focused ? "bg-canvas ring-2 ring-inset ring-ink" : ""
                    }`}
                  >
                  <div className="flex flex-wrap items-center gap-2">
                    {focused && (
                      <span className="rounded bg-ink px-1.5 py-0.5 text-[0.62rem] font-extrabold uppercase tracking-[0.1em] text-white">
                        Selected span log
                      </span>
                    )}
                    <span className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-extrabold uppercase tracking-[0.1em] ${
                      log.level === "error"
                        ? "border-incident/30 bg-incident/[0.06] text-incident"
                        : "border-steel bg-canvas text-slate"
                    }`}>
                      {log.level}
                    </span>
                    <span className="break-words font-mono text-xs font-bold text-ink [overflow-wrap:anywhere]">
                      {log.service}
                    </span>
                    {log.environment && (
                      <span className="font-mono text-[0.68rem] text-slate">{log.environment}</span>
                    )}
                  </div>
                  <p className="mt-2 break-words text-sm font-semibold leading-5 text-ink [overflow-wrap:anywhere]">
                    {log.message}
                  </p>
                  {log.stackTrace && (
                    <pre className="mt-2 overflow-x-auto rounded-md bg-canvas p-2.5 font-mono text-[0.68rem] leading-5 text-slate">
                      {log.stackTrace}
                    </pre>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[0.68rem] text-slate">
                    <time dateTime={log.timestamp}>{formatTime(log.timestamp)}</time>
                    {log.traceId && <span className="max-w-full truncate" title={log.traceId}>trace {log.traceId}</span>}
                    {log.spanId && <span className="max-w-full truncate" title={log.spanId}>span {log.spanId}</span>}
                  </div>
                  <Metadata metadata={log.metadata} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-slate">
              No error logs found in this investigation window.
            </p>
          )}
        </section>
      </div>
    </InvestigationDetailSection>
  );
}
