import { useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw, Search } from "lucide-react";
import { AlertListError, type AlertListDataSource } from "../data/alertListDataSource";
import {
  defaultAlertListView,
  liveInvestigationHref,
  selectAlerts,
  type AlertListView,
  type AlertStatusFilter,
} from "../lib/alertList";
import { formatDateTime } from "../lib/formatters";
import type { InvestigationAlert } from "../types/investigation";

type State = { status: "loading" } | { status: "error"; message: string } | {
  status: "ready";
  alerts: InvestigationAlert[];
  fetchedAt: string;
  refreshing: boolean;
  refreshError?: string;
};
const control = "rounded-md border border-steel bg-surface px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const statusStyles = {
  firing: "border-incident/30 bg-incident/[0.07] text-incident",
  acknowledged: "border-ink/30 bg-canvas text-ink",
  resolved: "border-steel bg-surface text-slate",
};

interface InvestigationsPageProps {
  dataSource: AlertListDataSource;
  initialView?: AlertListView;
  onViewChange?: (view: AlertListView) => void;
}

export function InvestigationsPage({
  dataSource,
  initialView = defaultAlertListView,
  onViewChange,
}: InvestigationsPageProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const requestPending = useRef(true);
  const previousSource = useRef(dataSource);
  const [query, setQuery] = useState(initialView.query);
  const [status, setStatus] = useState<AlertStatusFilter>(initialView.status);

  useEffect(() => {
    setQuery(initialView.query);
    setStatus(initialView.status);
  }, [initialView.query, initialView.status]);

  useEffect(() => {
    document.title = "Investigations · Observability Platform";
    const controller = new AbortController();
    let active = true;
    requestPending.current = true;
    const sourceChanged = previousSource.current !== dataSource;
    previousSource.current = dataSource;
    setState((previous) => !sourceChanged && previous.status === "ready"
      ? { ...previous, refreshing: true, refreshError: undefined }
      : { status: "loading" });
    dataSource.getAlerts({ signal: controller.signal }).then((alerts) => {
      if (active) {
        requestPending.current = false;
        setState({ status: "ready", alerts, fetchedAt: new Date().toISOString(), refreshing: false });
      }
    }).catch((error: unknown) => {
      if (active && !controller.signal.aborted) {
        requestPending.current = false;
        const message = error instanceof AlertListError ? error.message : "The alert list could not be loaded. Try again.";
        setState((previous) => previous.status === "ready"
          ? { ...previous, refreshing: false, refreshError: message }
          : { status: "error", message });
      }
    });
    return () => { active = false; controller.abort(); };
  }, [dataSource, version]);

  function refresh() {
    if (requestPending.current) return;
    requestPending.current = true;
    setVersion((v) => v + 1);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const busy = state.status === "loading" || (state.status === "ready" && state.refreshing);

  const visible = state.status === "ready" ? selectAlerts(state.alerts, query, status) : [];
  return (
    <section aria-labelledby="investigations-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 id="investigations-title" className="text-2xl font-extrabold tracking-tight text-ink">Investigations</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate">Browse alerts and open their investigation to review the observed evidence.</p>
        </div>
        <button type="button" disabled={busy} onClick={refresh} className={`${control} inline-flex items-center gap-2 font-bold disabled:opacity-50`}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{state.status === "ready" && state.refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="mt-6 grid gap-4 rounded-xl border border-steel bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="min-w-0">
          <label htmlFor="alert-search" className="block text-xs font-bold text-slate">Search alerts</label>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate" aria-hidden="true" />
            <input id="alert-search" type="search" value={query} onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              onViewChange?.({ query: nextQuery, status });
            }} placeholder="Title, service, or message" className={`${control} w-full pl-9`} />
          </div>
        </div>
        <div>
          <label htmlFor="alert-status" className="block text-xs font-bold text-slate">Status</label>
          <select id="alert-status" value={status} onChange={(event) => {
            const nextStatus = event.target.value as AlertStatusFilter;
            setStatus(nextStatus);
            onViewChange?.({ query, status: nextStatus });
          }} className={`${control} mt-2 w-full`}>
            <option value="all">All statuses</option><option value="firing">Firing</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {state.status === "loading" && <p role="status" className="mt-6 text-sm text-slate">Loading alerts…</p>}
      {state.status === "error" && <div role="alert" className="mt-6 rounded-xl border border-steel bg-surface p-5">
        <h2 className="font-extrabold">Unable to load alerts</h2><p className="mt-2 text-sm text-slate">{state.message}</p>
        <button type="button" className={`${control} mt-4 font-bold`} onClick={refresh}>Try again</button>
      </div>}
      {state.status === "ready" && <>
        <p role="status" className="mt-4 text-xs text-slate">
          Last fetched successfully: <time dateTime={state.fetchedAt}>{formatDateTime(state.fetchedAt)}</time>
          {state.refreshing && " · Refreshing alerts…"}
        </p>
        {state.refreshError && <div role="alert" className="mt-4 rounded-xl border border-steel bg-surface p-5">
          <h2 className="font-extrabold">Unable to refresh alerts</h2>
          <p className="mt-2 text-sm text-slate">{state.refreshError} Showing previously fetched results; they may be out of date.</p>
          <button type="button" className={`${control} mt-4 font-bold`} onClick={refresh}>Try again</button>
        </div>}
        <p role="status" className="my-4 text-xs text-slate">{visible.length} of {state.alerts.length} alerts · Most recently updated first</p>
        {visible.length === 0 ? <div className="rounded-xl border border-steel bg-surface p-6">
          <h2 className="font-extrabold">{state.alerts.length === 0 ? "No alerts yet" : "No matching alerts"}</h2>
          <p className="mt-2 text-sm text-slate">{state.alerts.length === 0 ? "Alerts will appear here when the backend records them." : "Try another search or clear the filters."}</p>
          {state.alerts.length > 0 && <button type="button" className={`${control} mt-4`} onClick={() => {
            setQuery("");
            setStatus("all");
            onViewChange?.(defaultAlertListView);
          }}>Clear filters</button>}
        </div> : <ul className="space-y-3">
          {visible.map((alert) => <li key={alert.id} className="grid gap-4 rounded-xl border border-steel bg-surface p-4 shadow-panel sm:p-5 lg:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyles[alert.status]}`}>{alert.status}</span>
                <span className="break-all font-mono text-xs text-slate">{alert.service || "Service not specified"}</span>
              </div>
              <h2 className="mt-3 break-words text-base font-extrabold [overflow-wrap:anywhere]">{alert.title}</h2>
              <p className="mt-1 break-words text-sm leading-6 text-slate [overflow-wrap:anywhere]">{alert.message}</p>
              <a href={liveInvestigationHref(alert.id, { query, status })} className="mt-3 inline-flex items-center gap-2 rounded text-sm font-bold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" aria-label={`Open investigation: ${alert.title} (${alert.id})`}>Open investigation<ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
            </div>
            <dl className="grid min-w-0 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-1 lg:content-start">
              <div><dt className="font-bold text-slate">Started</dt><dd className="mt-1"><time dateTime={alert.startedAt}>{formatDateTime(alert.startedAt)}</time></dd></div>
              <div><dt className="font-bold text-slate">Last updated</dt><dd className="mt-1"><time dateTime={alert.updatedAt}>{formatDateTime(alert.updatedAt)}</time></dd></div>
            </dl>
          </li>)}
        </ul>}
      </>}
    </section>
  );
}
