import { useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleX,
  Network,
  ScrollText,
  Timer,
  Waypoints,
} from "lucide-react";
import { formatDuration, formatTime } from "../lib/formatters";
import {
  buildExactSpanLogLookup,
  exactSpanLogKey,
  type ExactSpanReference,
  type IndexedExactSpanLog,
} from "../lib/exactSpanLogs";
import {
  logDomId,
  traceDomId,
  traceSpanDomId,
} from "../lib/investigationTargets";
import type { LogEvent, TraceNode } from "../types/investigation";

interface TraceTreeProps {
  traces: TraceNode[];
  logs?: LogEvent[];
  selectedExactSpan?: ExactSpanReference | null;
  onReviewExactSpanLogs?: (reference: ExactSpanReference) => void;
}

function TraceNodeItem({
  node,
  exactLogsBySpan,
  selectedExactSpan,
  onReviewExactSpanLogs,
  depth = 0,
  parentService,
}: {
  node: TraceNode;
  exactLogsBySpan: ReadonlyMap<string, readonly IndexedExactSpanLog[]>;
  selectedExactSpan?: ExactSpanReference | null;
  onReviewExactSpanLogs?: (reference: ExactSpanReference) => void;
  depth?: number;
  parentService?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isError = node.status === "error";
  const isServiceTransition =
    parentService !== undefined && parentService !== node.service;
  const StatusIcon = isError ? CircleX : CheckCircle2;
  const exactLogs =
    exactLogsBySpan.get(exactSpanLogKey(node.traceId, node.spanId)) ?? [];
  const exactSpanSelected =
    selectedExactSpan?.traceId === node.traceId &&
    selectedExactSpan.spanId === node.spanId;
  const firstExactLog = exactLogs[0];

  return (
    <li
      id={depth === 0 ? traceDomId(node.traceId) : undefined}
      className="trace-branch scroll-mt-4"
      data-error={isError ? "true" : "false"}
    >
      <div
        id={traceSpanDomId(node.traceId, node.spanId)}
        data-exact-span-log-count={exactLogs.length}
        className={`trace-node group relative grid min-w-[29rem] grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-surface px-3.5 py-3 transition-colors sm:min-w-[34rem] ${
          isError
            ? "border-incident/35 border-l-4 border-l-incident"
            : "border-steel hover:border-slate/50"
        } ${exactSpanSelected ? "ring-2 ring-inset ring-ink" : ""}`}
      >
        {hasChildren ? (
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md border border-steel bg-canvas text-slate hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.service} ${node.operation} span`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="grid h-8 w-8 place-items-center text-steel" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-current" />
          </span>
        )}

        <div className="min-w-0">
          {isServiceTransition && (
            <p className="mb-1 flex items-center gap-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.08em] text-slate">
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
              Service transition
            </p>
          )}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="min-w-0 break-words font-mono text-sm font-extrabold text-ink [overflow-wrap:anywhere]">
              {node.service}
            </span>
            <span className="text-xs text-slate" aria-hidden="true">
              /
            </span>
            <span className="min-w-0 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">
              {node.operation}
            </span>
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1 font-mono text-[0.66rem] text-slate">
            <span className="max-w-full truncate" title={node.traceId}>
              trace {node.traceId}
            </span>
            <span className="max-w-full truncate" title={node.spanId}>
              span {node.spanId}
            </span>
            <span>depth {depth}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 pl-2 sm:flex-row sm:items-center sm:gap-4 sm:pl-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold tabular-nums text-ink">
            <Timer className="h-3.5 w-3.5 text-slate" aria-hidden="true" />
            {formatDuration(node.durationMs)}
          </span>
          <span
            className={`inline-flex min-w-[4.4rem] items-center justify-end gap-1.5 text-[0.66rem] font-extrabold uppercase tracking-[0.1em] ${
              isError ? "text-incident" : "text-slate"
            }`}
          >
            <StatusIcon className="h-4 w-4" aria-hidden="true" />
            {node.status}
          </span>
        </div>

        {exactLogs.length > 0 && (
          <div className="col-span-2 col-start-2 border-t border-steel pt-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[0.64rem] font-extrabold uppercase tracking-[0.11em] text-slate">
                <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                Exact-span logs
                <span className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[0.62rem] text-ink">
                  {exactLogs.length}
                </span>
              </p>
              {firstExactLog && onReviewExactSpanLogs && (
                <a
                  href={`#${logDomId(
                    firstExactLog.log.timestamp,
                    firstExactLog.log.service,
                    firstExactLog.index,
                  )}`}
                  onClick={() =>
                    onReviewExactSpanLogs({
                      traceId: node.traceId,
                      spanId: node.spanId,
                    })
                  }
                  className="inline-flex items-center gap-1 text-[0.68rem] font-extrabold text-slate underline decoration-steel underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  Review linked logs
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
            </div>
            <ul className="mt-2 space-y-1.5">
              {exactLogs.slice(0, 2).map(({ index, log }) => (
                <li
                  key={`${log.timestamp}-${log.service}-${index}`}
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded bg-canvas/70 px-2.5 py-1.5 text-[0.68rem]"
                >
                  <span className={`font-extrabold uppercase tracking-[0.08em] ${
                    log.level === "error" ? "text-incident" : "text-slate"
                  }`}>
                    {log.level}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={log.message}>
                    {log.message}
                  </span>
                  <time dateTime={log.timestamp} className="shrink-0 font-mono text-slate">
                    {formatTime(log.timestamp)}
                  </time>
                </li>
              ))}
            </ul>
            {exactLogs.length > 2 && (
              <p className="mt-1.5 text-[0.65rem] font-semibold text-slate">
                +{exactLogs.length - 2} more exact-span {exactLogs.length - 2 === 1 ? "log" : "logs"}
              </p>
            )}
          </div>
        )}
      </div>

      {hasChildren && expanded && (
        <ul className="trace-children" aria-label={`Child spans of ${node.service} ${node.operation}`}>
          {node.children.map((child) => (
            <TraceNodeItem
              key={child.spanId}
              node={child}
              exactLogsBySpan={exactLogsBySpan}
              selectedExactSpan={selectedExactSpan}
              onReviewExactSpanLogs={onReviewExactSpanLogs}
              depth={depth + 1}
              parentService={node.service}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TraceTree({
  traces,
  logs = [],
  selectedExactSpan,
  onReviewExactSpanLogs,
}: TraceTreeProps) {
  const exactLogsBySpan = useMemo(() => buildExactSpanLogLookup(logs), [logs]);

  return (
    <section
      id="trace-path"
      tabIndex={-1}
      className="mt-6 scroll-mt-20 overflow-hidden rounded-xl border border-steel bg-surface shadow-panel"
      aria-labelledby="trace-heading"
      aria-describedby="trace-description"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-steel px-5 py-4 sm:px-6">
        <div>
          <p className="flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-[0.17em] text-slate">
            <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />
            Cross-service call chain
          </p>
          <h2 id="trace-heading" className="mt-1 text-lg font-extrabold tracking-tight text-ink">
            Distributed trace path
          </h2>
          <p id="trace-description" className="mt-1 max-w-2xl text-xs leading-5 text-slate">
            Connectors show parent-to-child calls. Error styling identifies failed spans; it
            does not assign incident causality.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-canvas px-2.5 py-1.5 font-mono text-xs font-bold text-slate">
          <Network className="h-4 w-4" aria-hidden="true" />
          {traces.length} root {traces.length === 1 ? "trace" : "traces"}
        </div>
      </div>

      {traces.length > 0 ? (
        <div
          className="trace-scroll overflow-x-auto px-4 py-5 sm:px-6"
          tabIndex={0}
          role="region"
          aria-label="Scrollable distributed trace hierarchy"
        >
          <ul className="min-w-[33rem] space-y-3 sm:min-w-[38rem]">
            {traces.map((trace) => (
              <TraceNodeItem
                key={trace.spanId}
                node={trace}
                exactLogsBySpan={exactLogsBySpan}
                selectedExactSpan={selectedExactSpan}
                onReviewExactSpanLogs={onReviewExactSpanLogs}
              />
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex min-h-44 items-center justify-center px-6 py-10 text-center">
          <div>
            <Network className="mx-auto h-7 w-7 text-slate" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-ink">
              No traces found in this investigation window.
            </p>
            <p className="mt-1 text-xs text-slate">
              The investigation can continue with metric and log evidence.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
