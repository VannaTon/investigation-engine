import type { ReactNode } from "react";
import {
  Clock3,
  LockKeyhole,
  Server,
} from "lucide-react";
import { formatDateTime } from "../lib/formatters";
import { AlertIdentifiers } from "./AlertIdentifiers";
import { AlertStatusBadge } from "./AlertStatusBadge";
import type { AlertInvestigationResponse } from "../types/investigation";

interface InvestigationOverviewProps {
  investigation: AlertInvestigationResponse;
  children?: ReactNode;
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
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate">
        {label}
      </p>
      <p
        className={`mt-1.5 text-2xl font-bold tracking-tight ${critical ? "text-incident" : "text-ink"}`}
      >
        {value}
      </p>
      <p className="mt-1 break-words text-xs text-slate [overflow-wrap:anywhere]" title={detail}>
        {detail}
      </p>
    </div>
  );
}

export function InvestigationOverview({
  investigation,
  children,
}: InvestigationOverviewProps) {
  const { alert, window, summary } = investigation;
  const isResolved = alert.status === "resolved";
  const isFiring = alert.status === "firing";

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
              <AlertStatusBadge status={alert.status} />
              {alert.service && (
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 font-mono text-xs font-semibold text-slate">
                  <Server className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{alert.service}</span>
                </span>
              )}
            </div>

            <h1
              id="alert-title"
              className="mt-4 max-w-4xl break-words text-2xl font-extrabold tracking-[-0.025em] text-ink [overflow-wrap:anywhere] sm:text-3xl"
            >
              {alert.title}
            </h1>
            <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-slate [overflow-wrap:anywhere]">
              {alert.message}
            </p>
            <AlertIdentifiers alert={alert} />
          </div>

          <dl className="grid min-w-0 gap-3 text-xs sm:min-w-[17rem] sm:grid-cols-2 lg:grid-cols-1">
            <div>
              <dt className="font-bold uppercase tracking-[0.12em] text-slate">
                Started
              </dt>
              <dd className="mt-1 break-words font-mono font-semibold tabular-nums text-ink [overflow-wrap:anywhere]">
                {formatDateTime(alert.startedAt)}
              </dd>
            </div>
            <div>
              <dt className="font-bold uppercase tracking-[0.12em] text-slate">
                {isResolved ? "Resolved" : "Last alert update"}
              </dt>
              <dd className="mt-1 break-words font-mono font-semibold tabular-nums text-ink [overflow-wrap:anywhere]">
                {formatDateTime(isResolved ? alert.resolvedAt ?? alert.updatedAt : alert.updatedAt)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {children}

      <section
        className="mt-4 rounded-xl border border-steel bg-surface p-5 shadow-panel"
        aria-labelledby="window-heading"
        aria-describedby="window-description"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p
              id="window-heading"
              className="text-xs font-bold uppercase tracking-[0.16em] text-slate"
            >
              Evidence time range
            </p>
            <div className="mt-2 flex items-center gap-2">
              {isResolved ? (
                <LockKeyhole className="h-4 w-4 text-slate" aria-hidden="true" />
              ) : (
                <Clock3 className="h-4 w-4 text-slate" aria-hidden="true" />
              )}
              <span className="text-sm font-extrabold text-ink">
                {isResolved ? "Resolved evidence window" : "Evidence snapshot"}
              </span>
            </div>
            <p id="window-description" className="mt-1 max-w-3xl text-sm leading-6 text-slate">
              {isResolved
                ? "This alert is resolved. The times below show the range of records loaded at your last refresh."
                : "This alert is still open. It does not close just because time has passed. These are the records loaded at your last refresh; this view does not show whether new data is arriving."}
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs font-semibold tabular-nums text-ink">
            {isResolved ? (
              <LockKeyhole className="h-4 w-4 text-slate" aria-hidden="true" />
            ) : (
              <Clock3 className="h-4 w-4 text-slate" aria-hidden="true" />
            )}
            {isResolved ? "Resolved" : "Unresolved"}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(3rem,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <span className="block text-xs font-bold uppercase tracking-widest text-slate">
              Evidence from
            </span>
            <time dateTime={window.from} className="mt-1 block break-words font-mono text-xs font-semibold tabular-nums text-ink [overflow-wrap:anywhere]">
              {formatDateTime(window.from)}
            </time>
          </div>
          <div className="hidden h-px bg-steel sm:block" aria-hidden="true" />
          <div className="min-w-0 sm:text-right">
            <span className="block text-xs font-bold uppercase tracking-widest text-slate">
              Evidence through
            </span>
            <time dateTime={window.to} className="mt-1 block break-words font-mono text-xs font-semibold tabular-nums text-ink [overflow-wrap:anywhere]">
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
          label="Failed steps"
          value={summary.errorSpans}
          detail="Steps marked as errors (spans)"
          critical={summary.errorSpans > 0}
        />
        <SummaryStat
          label="Metric findings"
          value={summary.metricAnomalies}
          detail="Readings that met an alert rule"
          critical={summary.metricAnomalies > 0}
        />
        <SummaryStat
          label="Error logs"
          value={summary.logErrors}
          detail="Log records marked as errors"
          critical={summary.logErrors > 0}
        />
      </section>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.13em] text-slate">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          Services in this evidence
        </span>
        {summary.servicesInvolved.length > 0 ? (
          summary.servicesInvolved.map((service) => (
            <span
              key={service}
              className="min-w-0 max-w-full break-words rounded-md border border-steel bg-surface px-2 py-1 font-mono text-xs font-semibold text-ink [overflow-wrap:anywhere]"
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
