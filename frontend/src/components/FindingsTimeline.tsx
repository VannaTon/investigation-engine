import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileSearch,
  Gauge,
  Network,
  ScrollText,
} from "lucide-react";
import { FindingEvidenceReview } from "./FindingEvidenceReview";
import { InvestigationDetailSection } from "./InvestigationDetailSection";
import { buildFindingEvidenceReview } from "../lib/findingEvidenceReview";
import { findingDomId } from "../lib/correlations";
import { formatMetric, formatTime, humanize, parseTimestamp } from "../lib/formatters";
import type { ExactSpanReference } from "../lib/exactSpanLogs";
import type { FindingEvidenceReview as FindingEvidenceReviewModel } from "../lib/findingEvidenceReview";
import type {
  InvestigationCorrelation,
  InvestigationEvidenceGroup,
  InvestigationEvidenceRank,
  InvestigationFinding,
  InvestigationSignal,
  InvestigationTimelineItem,
  LogEvent,
  TraceNode,
} from "../types/investigation";

export type FindingsTimelineDetail = "findings" | "timeline";

interface FindingsTimelineProps {
  findings: InvestigationFinding[];
  timeline: InvestigationTimelineItem[];
  priorityFindingIds?: readonly string[];
  highlightedFindingIds?: ReadonlySet<string>;
  highlightedFindingLabel?: string;
  grouped?: boolean;
  openSection?: FindingsTimelineDetail | null;
  onOpenSection?: (section: FindingsTimelineDetail | null) => void;
  evidenceRanks?: InvestigationEvidenceRank[];
  evidenceGroups?: InvestigationEvidenceGroup[];
  correlations?: InvestigationCorrelation[];
  signals?: InvestigationSignal[];
  logs?: LogEvent[];
  traces?: TraceNode[];
  reviewedFindingId?: string | null;
  onReviewFinding?: (findingId: string | null) => void;
  onOpenExactSpanLogs?: (reference: ExactSpanReference) => void;
}

const findingIcons = {
  metric_threshold: Gauge,
  log_error: ScrollText,
  trace_error: Network,
};

const severityStyles = {
  critical: {
    rail: "before:bg-incident",
    icon: "border-incident bg-incident text-white",
    label: "text-incident",
  },
  high: {
    rail: "before:bg-incident/75",
    icon: "border-incident/25 bg-incident/[0.06] text-incident",
    label: "text-incident",
  },
  warning: {
    rail: "before:bg-ink/60",
    icon: "border-ink/20 bg-canvas text-ink",
    label: "text-ink",
  },
  info: {
    rail: "before:bg-steel",
    icon: "border-steel bg-canvas text-slate",
    label: "text-slate",
  },
};

function EmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center px-6 py-10 text-center">
      <p className="max-w-sm text-sm leading-6 text-slate">{children}</p>
    </div>
  );
}

function FindingRow({
  finding,
  highlighted = false,
  highlightedLabel = "Connected finding",
  reviewed = false,
  review,
  onReviewFinding,
  onOpenExactSpanLogs,
}: {
  finding: InvestigationFinding;
  highlighted?: boolean;
  highlightedLabel?: string;
  reviewed?: boolean;
  review?: FindingEvidenceReviewModel | null;
  onReviewFinding?: (findingId: string | null) => void;
  onOpenExactSpanLogs?: (reference: ExactSpanReference) => void;
}) {
  const Icon = findingIcons[finding.type];
  const styles = severityStyles[finding.severity];
  const reviewId = findingDomId(finding.id) + "-evidence-review";

  return (
    <li
      id={findingDomId(finding.id)}
      className={`relative scroll-mt-4 border-b border-steel px-5 py-4 before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r last:border-b-0 ${styles.rail} ${
        highlighted ? "bg-canvas ring-2 ring-inset ring-ink" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${styles.icon}`}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {highlighted && (
              <span className="rounded bg-ink px-1.5 py-0.5 text-[0.62rem] font-extrabold uppercase tracking-[0.1em] text-white">
                {highlightedLabel}
              </span>
            )}
            <span
              className={`text-[0.65rem] font-extrabold uppercase tracking-[0.13em] ${styles.label}`}
            >
              {finding.severity} severity
            </span>
            <span className="text-steel" aria-hidden="true">/</span>
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-slate">
              {humanize(finding.type)}
            </span>
            {finding.service && (
              <span className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold text-slate">
                {finding.service}
              </span>
            )}
          </div>
          <p className="mt-1.5 break-words text-sm font-semibold leading-5 text-ink [overflow-wrap:anywhere]">
            {finding.message}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[0.68rem] text-slate">
            <time dateTime={finding.timestamp}>{formatTime(finding.timestamp)}</time>
            {finding.traceId && (
              <span className="max-w-full truncate rounded bg-canvas px-1.5 py-0.5" title={finding.traceId}>
                trace {finding.traceId}
              </span>
            )}
            {finding.spanId && (
              <span className="max-w-full truncate rounded bg-canvas px-1.5 py-0.5" title={finding.spanId}>
                span {finding.spanId}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-expanded={reviewed}
            aria-controls={reviewId}
            onClick={() => onReviewFinding?.(reviewed ? null : finding.id)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {reviewed ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {reviewed ? "Close evidence review" : "Review linked evidence"}
          </button>
          {reviewed && review && (
            <FindingEvidenceReview
              id={reviewId}
              review={review}
              onOpenExactSpanLogs={onOpenExactSpanLogs}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function timelinePresentation(item: InvestigationTimelineItem) {
  switch (item.type) {
    case "metric":
      return {
        Icon: Gauge,
        label: "Metric observed",
        title: `${item.data.name} = ${formatMetric(item.data.value, item.data.unit)}`,
        detail: item.data.service,
        critical: false,
      };
    case "log":
      return {
        Icon: ScrollText,
        label: `${item.data.level} log`,
        title: item.data.message,
        detail: item.data.service,
        critical: item.data.level === "error",
      };
    case "alert_fired":
      return {
        Icon: BellRing,
        label: "Alert fired",
        title: item.data.title,
        detail: item.data.message,
        critical: true,
      };
    case "alert_resolved":
      return {
        Icon: CheckCircle2,
        label: "Alert resolved",
        title: item.data.title,
        detail: "Alert lifecycle closed",
        critical: false,
      };
  }
}

function TimelineRow({ item, last }: { item: InvestigationTimelineItem; last: boolean }) {
  const presentation = timelinePresentation(item);
  const Icon = presentation.Icon;

  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 px-4 py-3.5 sm:grid-cols-[5.9rem_1.75rem_minmax(0,1fr)] sm:px-5">
      {!last && (
        <span
          className="absolute bottom-[-0.875rem] left-[1.875rem] top-[3.75rem] w-px bg-steel sm:left-[7.08rem] sm:top-8"
          aria-hidden="true"
        />
      )}
      <time
        dateTime={item.timestamp}
        className="col-span-2 font-mono text-[0.68rem] font-semibold tabular-nums text-slate sm:col-span-1 sm:pt-1"
      >
        {formatTime(item.timestamp).replace(" UTC", "")}
      </time>
      <span
        className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border bg-surface ${
          presentation.critical
            ? "border-incident text-incident"
            : "border-steel text-slate"
        }`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 pb-1">
        <p
          className={`text-[0.65rem] font-extrabold uppercase tracking-[0.12em] ${
            presentation.critical ? "text-incident" : "text-slate"
          }`}
        >
          {presentation.label}
        </p>
        <p className="mt-1 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">
          {presentation.title}
        </p>
        <p className="mt-0.5 break-words text-xs leading-5 text-slate [overflow-wrap:anywhere]">
          {presentation.detail}
        </p>
      </div>
    </li>
  );
}

export function FindingsTimeline({
  findings,
  timeline,
  priorityFindingIds,
  highlightedFindingIds,
  highlightedFindingLabel,
  grouped = false,
  openSection,
  onOpenSection,
  evidenceRanks = [],
  evidenceGroups = [],
  correlations = [],
  signals = [],
  logs = [],
  traces = [],
  reviewedFindingId,
  onReviewFinding,
  onOpenExactSpanLogs,
}: FindingsTimelineProps) {
  const [query, setQuery] = useState("");
  const [service, setService] = useState("");
  const [severity, setSeverity] = useState("");
  const [findingType, setFindingType] = useState("");
  const [filtersClearedForLink, setFiltersClearedForLink] = useState(false);
  const [localReviewedFindingId, setLocalReviewedFindingId] = useState<
    string | null
  >(null);
  const reviewIsControlled = reviewedFindingId !== undefined;
  const activeReviewedFindingId = reviewIsControlled
    ? reviewedFindingId
    : localReviewedFindingId;
  const activeReview = useMemo(
    () =>
      activeReviewedFindingId
        ? buildFindingEvidenceReview(activeReviewedFindingId, {
            findings,
            evidenceRanks,
            evidenceGroups,
            correlations,
            signals,
            logs,
            traces,
          })
        : null,
    [
      activeReviewedFindingId,
      findings,
      evidenceRanks,
      evidenceGroups,
      correlations,
      signals,
      logs,
      traces,
    ],
  );
  function setReviewedFinding(findingId: string | null) {
    if (!reviewIsControlled) {
      setLocalReviewedFindingId(findingId);
    }
    onReviewFinding?.(findingId);
  }
  const services = useMemo(() => [...new Set(findings.flatMap(f => f.service ? [f.service] : []))].sort(), [findings]);
  const search = query.trim().toLowerCase();
  const filteredFindings = findings.filter(f =>
    (!search || `${f.message} ${f.service ?? ""}`.toLowerCase().includes(search)) &&
    (!service || f.service === service) &&
    (!severity || f.severity === severity) &&
    (!findingType || f.type === findingType),
  );
  const hasFilters = Boolean(query || service || severity || findingType);
  function clearFilters() {
    setQuery("");
    setService("");
    setSeverity("");
    setFindingType("");
  }
  const selectionKey = JSON.stringify([...(highlightedFindingIds ?? [])]);
  useEffect(() => {
    if (openSection === "findings" && highlightedFindingIds?.size) {
      if (hasFilters) setFiltersClearedForLink(true);
      clearFilters();
    }
    // Navigation clears filters; editing a filter must not clear itself.
  }, [openSection, selectionKey]);
  const controlClass = "mt-1 w-full min-w-0 rounded-md border border-steel bg-surface px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  const orderedTimeline = useMemo(
    () =>
      [...timeline].sort(
        (left, right) =>
          parseTimestamp(left.timestamp).getTime() -
          parseTimestamp(right.timestamp).getTime(),
      ),
    [timeline],
  );
  const previewFindings = useMemo(() => {
    if (!priorityFindingIds?.length) return findings.slice(0, 3);
    const byId = new Map(findings.map((finding) => [finding.id, finding]));
    return priorityFindingIds
      .map((findingId) => byId.get(findingId))
      .filter((finding): finding is InvestigationFinding => Boolean(finding))
      .slice(0, 3);
  }, [findings, priorityFindingIds]);
  const timelineHighlights = useMemo(() => {
    const lifecycle = orderedTimeline.filter(
      (item) => item.type === "alert_fired" || item.type === "alert_resolved",
    );
    if (lifecycle.length > 0) return lifecycle.slice(0, 2);
    if (orderedTimeline.length <= 2) return orderedTimeline;
    return [orderedTimeline[0], orderedTimeline[orderedTimeline.length - 1]];
  }, [orderedTimeline]);
  const controlled = openSection !== undefined;
  const findingsOpen = controlled ? openSection === "findings" : undefined;
  const timelineOpen = controlled ? openSection === "timeline" : undefined;

  useEffect(() => {
    if (
      !findingsOpen ||
      !highlightedFindingIds?.size ||
      typeof document === "undefined" ||
      typeof window === "undefined"
    ) {
      return;
    }

    const targetId = findingDomId([...highlightedFindingIds][0]);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [findingsOpen, highlightedFindingIds]);

  return (
    <div className={grouped ? "" : "grid gap-4 xl:grid-cols-2"}>
      <InvestigationDetailSection
        id="findings"
        eyebrow="Observed facts"
        title="Findings"
        description={
          findings.length === 0
            ? "No findings were generated for this investigation."
            : `${Math.min(previewFindings.length, findings.length)} highest-priority findings shown.`
        }
        count={findings.length}
        Icon={FileSearch}
        actionLabel="View all"
        drawerTitle="All findings"
        drawerDescription="Complete metric, log, and trace findings with telemetry references."
        grouped={grouped}
        open={findingsOpen}
        onOpenChange={(open) => onOpenSection?.(open ? "findings" : null)}
        preview={
          previewFindings.length > 0 ? (
            <ul className="space-y-1">
              {previewFindings.map((finding) => (
                <li key={finding.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    finding.severity === "critical" || finding.severity === "high"
                      ? "bg-incident"
                      : "bg-slate"
                  }`} aria-hidden="true" />
                  <span className="truncate font-semibold text-ink">{finding.message}</span>
                  <span className="shrink-0 font-mono text-[0.65rem] text-slate">
                    {finding.service ?? humanize(finding.type)}
                  </span>
                </li>
              ))}
            </ul>
          ) : undefined
        }
      >
        {findings.length > 0 && (
          <div className="border-b border-steel px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="min-w-0 text-xs font-bold text-slate sm:col-span-2">
                Search findings
                <input type="search" value={query} placeholder="Search message or service" className={controlClass}
                  onChange={event => { setQuery(event.target.value); setFiltersClearedForLink(false); }} />
              </label>
              <label className="min-w-0 text-xs font-bold text-slate">
                Service
                <select value={service} className={controlClass} onChange={event => { setService(event.target.value); setFiltersClearedForLink(false); }}>
                  <option value="">All services</option>
                  {services.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="min-w-0 text-xs font-bold text-slate">
                Severity
                <select value={severity} className={controlClass} onChange={event => { setSeverity(event.target.value); setFiltersClearedForLink(false); }}>
                  <option value="">All severities</option>
                  {["critical", "high", "warning", "info"].map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                </select>
              </label>
              <label className="min-w-0 text-xs font-bold text-slate sm:col-span-2">
                Finding type
                <select value={findingType} className={controlClass} onChange={event => { setFindingType(event.target.value); setFiltersClearedForLink(false); }}>
                  <option value="">All finding types</option>
                  {Object.keys(findingIcons).map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-xs text-slate">Showing {filteredFindings.length} of {findings.length} findings</p>
              <button type="button" disabled={!hasFilters} onClick={() => { clearFilters(); setFiltersClearedForLink(false); }}
                className="rounded-md px-2 py-1 text-xs font-bold text-ink underline underline-offset-4 disabled:text-slate disabled:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Clear filters</button>
            </div>
            {filtersClearedForLink && <p role="status" className="mt-2 text-xs text-slate">Filters cleared to show linked findings.</p>}
          </div>
        )}
        {filteredFindings.length > 0 ? (
          <ul>
            {filteredFindings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                highlighted={
                  highlightedFindingIds?.has(finding.id) ||
                  activeReviewedFindingId === finding.id
                }
                highlightedLabel={highlightedFindingLabel}
                reviewed={activeReviewedFindingId === finding.id}
                review={
                  activeReviewedFindingId === finding.id ? activeReview : null
                }
                onReviewFinding={setReviewedFinding}
                onOpenExactSpanLogs={onOpenExactSpanLogs}
              />
            ))}
          </ul>
        ) : (
          <EmptyState>{findings.length > 0 ? "No findings match these filters. Change your search or clear filters to see all findings." : "No findings were generated for this investigation."}</EmptyState>
        )}
      </InvestigationDetailSection>

      <InvestigationDetailSection
        id="timeline"
        eyebrow="Ordered telemetry"
        title="Timeline"
        description={
          orderedTimeline.length === 0
            ? "No timeline events were recorded in this investigation window."
            : "Key lifecycle events from the investigation window."
        }
        count={orderedTimeline.length}
        Icon={Clock3}
        actionLabel="View full timeline"
        drawerTitle="Chronological evidence"
        drawerDescription="Complete telemetry and lifecycle sequence ordered by timestamp."
        grouped={grouped}
        open={timelineOpen}
        onOpenChange={(open) => onOpenSection?.(open ? "timeline" : null)}
        preview={
          timelineHighlights.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate">
              {timelineHighlights.map((item, index) => {
                const presentation = timelinePresentation(item);
                return (
                  <span key={`${item.type}-${item.timestamp}`} className="inline-flex items-center gap-2">
                    {index > 0 && <span aria-hidden="true">→</span>}
                    <span className={presentation.critical ? "font-semibold text-incident" : "font-semibold text-ink"}>
                      {presentation.label}
                    </span>
                    <time dateTime={item.timestamp} className="font-mono text-[0.65rem]">
                      {formatTime(item.timestamp).replace(" UTC", "")}
                    </time>
                  </span>
                );
              })}
            </div>
          ) : undefined
        }
      >
        {orderedTimeline.length > 0 ? (
          <ol>
            {orderedTimeline.map((item, index) => (
              <TimelineRow
                key={`${item.type}-${item.timestamp}-${index}`}
                item={item}
                last={index === orderedTimeline.length - 1}
              />
            ))}
          </ol>
        ) : (
          <EmptyState>No timeline events were recorded in this investigation window.</EmptyState>
        )}
      </InvestigationDetailSection>
    </div>
  );
}
