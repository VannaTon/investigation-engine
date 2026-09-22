import { useEffect, useState } from "react";
import type { MetricDiscoveryDataSource, MetricDiscoveryResult, ServiceDiscoveryResult } from "../data/metricDiscoveryDataSource";
import { formatDateTime } from "../lib/formatters";

const control = "mt-2 w-full rounded-md border border-steel bg-surface px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";
const button = "rounded-md border border-steel px-3 py-2 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";
type Services = { status: "loading" | "error" } | { status: "ready"; result: ServiceDiscoveryResult };
type Metrics = { status: "idle" | "loading" | "error"; service: string } | { status: "ready"; result: MetricDiscoveryResult };
interface MetricRuleSelectorsProps {
  applicationId: string;
  service: string;
  metricName: string;
  initialService?: string;
  initialMetricName?: string;
  busy: boolean;
  errors: { service?: string; metricName?: string };
  dataSource: MetricDiscoveryDataSource;
  onServiceChange: (value: string) => void;
  onMetricChange: (value: string, expectedService: string) => void;
  serviceRef: (node: HTMLSelectElement | null) => void;
  metricRef: (node: HTMLSelectElement | null) => void;
}

const supported = (name: string) => Boolean(name.trim()) && name.length <= 255;
const label = (name: string) => name === name.trim() ? name : JSON.stringify(name);

export function MetricRuleSelectors({ applicationId, service, metricName, initialService, initialMetricName, busy, errors,
  dataSource, onServiceChange, onMetricChange, serviceRef, metricRef }: MetricRuleSelectorsProps) {
  const [version, setVersion] = useState(0);
  const [services, setServices] = useState<Services>({ status: "loading" });
  const [metrics, setMetrics] = useState<Metrics>({ status: "idle", service: "" });
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setServices({ status: "loading" });
    if (!applicationId) { setServices({ status: "ready", result: { data: [], hasMore: false, window: { from: "", to: "" } } }); return () => controller.abort(); }
    dataSource.services(applicationId, controller.signal).then((result) => {
      if (active && !controller.signal.aborted) setServices({ status: "ready", result });
    }).catch(() => { if (active && !controller.signal.aborted) setServices({ status: "error" }); });
    return () => { active = false; controller.abort(); };
  }, [applicationId, dataSource, version]);
  useEffect(() => {
    if (!applicationId || !service) { setMetrics({ status: "idle", service: "" }); return; }
    const controller = new AbortController(); let active = true;
    setMetrics({ status: "loading", service });
    dataSource.metrics(applicationId, service, controller.signal).then((result) => {
      if (!active || controller.signal.aborted) return;
      setMetrics(result.service === service ? { status: "ready", result } : { status: "error", service });
    }).catch(() => { if (active && !controller.signal.aborted) setMetrics({ status: "error", service }); });
    return () => { active = false; controller.abort(); };
  }, [applicationId, dataSource, service, version]);

  const metricResult = metrics.status === "ready" && metrics.result.service === service ? metrics.result : undefined;
  const metricLoading = Boolean(service) && !metricResult && (metrics.status !== "error" || metrics.service !== service);
  const serviceNames = services.status === "ready" ? services.result.data : [];
  const metricNames = metricResult?.data.map((metric) => metric.name) ?? [];
  const pinnedServices = [...new Set([initialService, service].filter((name): name is string => Boolean(name) && !serviceNames.includes(name!)))];
  const pinnedMetrics = [...new Set([service === initialService ? initialMetricName : undefined, metricName]
    .filter((name): name is string => Boolean(name) && !metricNames.includes(name!)))];
  const selected = metricResult?.data.find((metric) => metric.name === metricName);
  const unknownService = Boolean(service) && services.status === "ready" && !serviceNames.includes(service);
  const unknownMetric = Boolean(metricName) && Boolean(metricResult) && !metricNames.includes(metricName);
  const chooseService = (value: string) => {
    if (!busy && supported(value) && (serviceNames.includes(value) || value === initialService || value === service)) onServiceChange(value);
    else if (!busy && value === "") onServiceChange("");
  };
  const chooseMetric = (value: string) => {
    if (!busy && supported(value) && (metricNames.includes(value) || service === initialService && value === initialMetricName || value === metricName)) onMetricChange(value, service);
    else if (!busy && value === "") onMetricChange("", service);
  };
  return <div className="sm:col-span-2">
    <div className="grid gap-5 sm:grid-cols-2">
      <div><label htmlFor="rule-service" className="block text-xs font-bold text-slate">Service</label>
        <select ref={serviceRef} id="rule-service" value={service} disabled={busy || services.status !== "ready"}
          aria-invalid={!!errors.service} aria-describedby={errors.service ? "rule-service-error" : "rule-choice-window"}
          onChange={(event) => chooseService(event.target.value)} className={control}>
          <option value="">{services.status === "loading" ? "Loading services..." : "Choose a service"}</option>
          {pinnedServices.map((name) => <option key={name} value={name}>{label(name)} — current selection</option>)}
          {serviceNames.map((name) => <option key={name} value={name} disabled={!supported(name)}>{label(name)}{!supported(name) ? " — cannot use this name" : ""}</option>)}
        </select>{errors.service && <p id="rule-service-error" className="mt-1 text-xs text-incident">{errors.service}</p>}
      </div>
      <div><label htmlFor="rule-metricName" className="block text-xs font-bold text-slate">Metric</label>
        <select ref={metricRef} id="rule-metricName" value={metricName} disabled={busy || !metricResult}
          aria-invalid={!!errors.metricName} aria-describedby={errors.metricName ? "rule-metricName-error" : "rule-choice-window"}
          onChange={(event) => chooseMetric(event.target.value)} className={control}>
          <option value="">{!service ? "Choose a service first" : metricLoading ? "Loading metrics..." : "Choose a metric"}</option>
          {pinnedMetrics.map((name) => <option key={name} value={name}>{label(name)} — current selection</option>)}
          {metricNames.map((name) => <option key={name} value={name} disabled={!supported(name)}>{label(name)}{!supported(name) ? " — cannot use this name" : ""}</option>)}
        </select>{errors.metricName && <p id="rule-metricName-error" className="mt-1 text-xs text-incident">{errors.metricName}</p>}
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p id="rule-choice-window" className="text-xs leading-5 text-slate">This list uses metric readings recorded in the last 24 hours, not sample investigations.</p>
      <button type="button" className={button} disabled={busy || services.status === "loading" || metricLoading} onClick={() => setVersion((value) => value + 1)}>Refresh choices</button>
    </div>
    {services.status === "loading" && <p role="status" className="mt-2 text-xs text-slate">Loading services...</p>}
    {services.status === "error" && <p role="alert" className="mt-2 text-xs text-incident">Services could not be loaded. Use Refresh choices to try again. Your current choices are kept.</p>}
    {services.status === "ready" && services.result.data.length === 0 && <p className="mt-2 text-xs text-slate">No metric readings were found for services in this time window. Send metrics from your application, then refresh choices.</p>}
    {services.status === "ready" && services.result.hasMore && <p className="mt-2 text-xs text-slate">This list does not show all services with metric readings.</p>}
    {metricLoading && <p role="status" className="mt-2 text-xs text-slate">Loading metrics for the selected service...</p>}
    {metrics.status === "error" && metrics.service === service && <p role="alert" className="mt-2 text-xs text-incident">Metrics could not be loaded. Use Refresh choices to try again. Your current choices are kept.</p>}
    {metricResult && metricNames.length === 0 && <p className="mt-2 text-xs text-slate">No metric readings were found for this service in the last 24 hours.</p>}
    {metricResult?.hasMore && <p className="mt-2 text-xs text-slate">This list does not show all metrics found.</p>}
    {(unknownService || unknownMetric) && <p className="mt-2 text-xs text-slate">Your current choice is not in the recent list shown. Its exact name is kept. The list may show only part of the data, so this does not mean the service or metric is unavailable.</p>}
    {selected && <div className="mt-3 rounded-lg border border-steel bg-canvas p-3 text-xs leading-5">
      <p>Unit: <strong>{selected.units.map((unit) => unit === "" ? "(not provided)" : JSON.stringify(unit)).join(", ") || "not provided"}</strong> · Metric type: {selected.types.join(", ")} · Last reading <time dateTime={selected.lastSeen}>{formatDateTime(selected.lastSeen)}</time></p>
      {selected.units.length > 1 && <p className="mt-1 text-incident">Different units were found. Check how your application records this metric. Values are not converted.</p>}
      {selected.units.includes("") && <p className="mt-1 text-slate">Some readings have no unit. Check what the metric measures before enabling the rule.</p>}
      {selected.types.some((type) => type !== "gauge") && <p className="mt-1 text-incident">This metric includes types other than gauge. Counters are running totals, not rates per second. For a simple threshold, use a gauge: a measurement at a point in time.</p>}
      {selected.metadataTruncated && <p className="mt-1 text-slate">More metric types or units are available but are not shown.</p>}
    </div>}
  </div>;
}
