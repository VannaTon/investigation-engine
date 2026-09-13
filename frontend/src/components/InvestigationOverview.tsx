import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  LockKeyhole,
  RadioTower,
  Server,
} from "lucide-react";
import { formatDateTime } from "../lib/formatters";
import type { AlertInvestigationResponse } from "../types/investigation";

interface InvestigationOverviewProps {
  investigation: AlertInvestigationResponse;
}

interface SummaryStatProps {
  label: string;
  value: string | number;
  detail: string;
  critical?: boolean;
}

function SummaryStat({ label, value, detail, critical = false }: SummaryStatProps) {
  return (
    <div className="min-w-0 px-4 py-4 first:pl-0 last:pr-0 sm:px-5">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate">
        {label}
      </p>
      <p
        className={`mt-1.5 text-2xl font-bold tracking-tight ${critical ? "text-incident" : "text-ink"}`}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-slate" title={detail}>
        {detail}
      </p>
    </div>
  );
}

export function InvestigationOverview({
  investigation,
}: InvestigationOverviewProps) {
  const { alert, window, summary } = investigation;
  const isResolved = alert.status === "resolved";
  const isFiring = alert.status === "firing";
  const StatusIcon = isResolved ? CheckCircle2 : CircleAlert;

  return (
    <>
      <section
        id="overview"
        tabIndex={-1}
        className={`scroll-mt-20 overflow-hidden rounded-xl border bg-surface shadow-panel ${
          isFiring ? "border-incident/35" : "border-steel"
        }`}
        aria-labelledby="alert-title"
      >
        <div
          className={`h-1 w-full ${isFiring ? "bg-incident" : "bg-slate"}`}
          aria-hidden="true"
        />
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-extrabold uppercase tracking-[0.13em] ${
                  isFiring
                    ? "border-incident/30 bg-incident/[0.07] text-incident"
                    : "border-steel bg-canvas text-ink"
                }`}
              >
                <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {alert.status}
              </span>
              {alert.service && (
                <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate">
                  <Server className="h-3.5 w-3.5" aria-hidden="true" />
                  {alert.service}
                </span>
              )}
            </div>

            <h1
              id="alert-title"
              className="mt-4 max-w-4xl text-2xl font-extrabold tracking-[-0.025em] text-ink sm:text-3xl"
            >
              {alert.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate">
              {alert.message}
            </p>
          </div>

          <dl className="grid min-w-0 gap-3 text-xs sm:min-w-[17rem] sm:grid-cols-2 lg:grid-cols-1">
            <div>
              <dt className="font-bold uppercase tracking-[0.12em] text-slate">
                Started
              </dt>
              <dd className="mt-1 font-mono font-semibold tabular-nums text-ink">
                {formatDateTime(alert.startedAt)}
              </dd>
            </div>
            <div>
              <dt className="font-bold uppercase tracking-[0.12em] text-slate">
                {isResolved ? "Resolved" : "Last updated"}
              </dt>
              <dd className="mt-1 font-mono font-semibold tabular-nums text-ink">
                {formatDateTime(alert.resolvedAt ?? alert.updatedAt)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section
        className="mt-4 rounded-xl border border-steel bg-surface p-5 shadow-panel"
        aria-labelledby="window-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p
              id="window-heading"
              className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate"
            >
              Investigation window
            </p>
            <div className="mt-2 flex items-center gap-2">
              {isResolved ? (
                <LockKeyhole className="h-4 w-4 text-slate" aria-hidden="true" />
              ) : (
                <span className="relative flex h-3 w-3" aria-hidden="true">
                  <span className="live-ping absolute inline-flex h-full w-full rounded-full bg-incident opacity-60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-incident" />
                </span>
              )}
              <span className="text-sm font-extrabold text-ink">
                {isResolved ? "Frozen evidence window" : "Live evidence window"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate">
              {isResolved
                ? "Finalized when the alert resolved."
                : "The investigation remains open for new evidence."}
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs font-semibold tabular-nums text-ink">
            {isResolved ? (
              <LockKeyhole className="h-4 w-4 text-slate" aria-hidden="true" />
            ) : (
              <RadioTower className="h-4 w-4 text-incident" aria-hidden="true" />
            )}
            {isResolved ? "FINALIZED" : "COLLECTING"}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 items-center gap-3 sm:grid-cols-[auto_minmax(3rem,1fr)_auto]">
          <div>
            <span className="block text-[0.65rem] font-bold uppercase tracking-widest text-slate">
              From
            </span>
            <time className="mt-1 block font-mono text-xs font-semibold tabular-nums text-ink">
              {formatDateTime(window.from)}
            </time>
          </div>
          <div className="relative order-last h-2 overflow-hidden rounded-full bg-steel sm:order-none" aria-hidden="true">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                isResolved ? "w-full bg-slate" : "live-window w-4/5 bg-incident"
              }`}
            />
          </div>
          <div className="sm:text-right">
            <span className="block text-[0.65rem] font-bold uppercase tracking-widest text-slate">
              To
            </span>
            <time className="mt-1 block font-mono text-xs font-semibold tabular-nums text-ink">
              {formatDateTime(window.to)}
            </time>
          </div>
        </div>
      </section>

      <section
        className="mt-4 grid grid-cols-2 divide-x divide-y divide-steel overflow-hidden rounded-xl border border-steel bg-surface shadow-panel md:grid-cols-4 md:divide-y-0"
        aria-label="Investigation summary"
      >
        <SummaryStat
          label="Services"
          value={summary.servicesInvolved.length}
          detail={summary.servicesInvolved.join(" · ") || "No services observed"}
        />
        <SummaryStat
          label="Error spans"
          value={summary.errorSpans}
          detail="Spans with error status"
          critical={summary.errorSpans > 0}
        />
        <SummaryStat
          label="Metric anomalies"
          value={summary.metricAnomalies}
          detail="Threshold observations"
          critical={summary.metricAnomalies > 0}
        />
        <SummaryStat
          label="Log errors"
          value={summary.logErrors}
          detail="Error-level log entries"
          critical={summary.logErrors > 0}
        />
      </section>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-bold uppercase tracking-[0.13em] text-slate">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          Services observed
        </span>
        {summary.servicesInvolved.length > 0 ? (
          summary.servicesInvolved.map((service) => (
            <span
              key={service}
              className="rounded-md border border-steel bg-surface px-2 py-1 font-mono text-xs font-semibold text-ink"
            >
              {service}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate">No services observed in this window.</span>
        )}
      </div>
    </>
  );
}
