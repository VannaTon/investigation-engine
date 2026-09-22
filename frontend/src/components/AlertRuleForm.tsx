import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MetricRuleInput, MetricThresholdRuleConfig } from "../types/alertRule";
import type { MetricSample, MetricSampleDataSource } from "../data/metricSampleDataSource";
import type { MetricDiscoveryDataSource } from "../data/metricDiscoveryDataSource";
import type { Application } from "../types/application";
import { MetricRuleSelectors } from "./MetricRuleSelectors";
import { formatDateTime } from "../lib/formatters";

const control = "mt-2 w-full rounded-md border border-steel bg-surface px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";
const button = "rounded-md border border-steel px-3 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";
const operatorLabels: Record<string, string> = { ">": "Above (>)", ">=": "At or above (>=)", "<": "Below (<)", "<=": "At or below (<=)" };
export interface RuleFormValues {
  applicationId: string; name: string; service: string; metricName: string; operator: string; threshold: string;
  windowMinutes: string; recoveryWindowMinutes: string; stalenessMinutes: string;
}

export function validateRuleForm(values: RuleFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.applicationId) errors.applicationId = "Choose an application.";
  for (const field of ["name", "service", "metricName"] as const) {
    if (!values[field].trim()) errors[field] = "Enter a value; spaces alone are not enough.";
    else if (values[field].length > 255) errors[field] = "Use 255 characters or fewer.";
  }
  if (![">", ">=", "<", "<="].includes(values.operator)) errors.operator = "Choose above, at or above, below, or at or below.";
  if (!values.threshold.trim() || !Number.isFinite(Number(values.threshold))) errors.threshold = "Enter a number, not infinity; zero and negative numbers are allowed.";
  for (const field of ["windowMinutes", "recoveryWindowMinutes", "stalenessMinutes"] as const) {
    if (!values[field].trim() || !Number.isFinite(Number(values[field])) || Number(values[field]) <= 0
      || Number(values[field]) * 60_000 > 8.64e15 - Date.now()) errors[field] = "Enter a number above zero that is not too large.";
  }
  return errors;
}

interface AlertRuleFormProps {
  initial?: MetricRuleInput;
  applications: Application[];
  editing?: boolean;
  busy: boolean;
  error?: string;
  sampleDataSource: MetricSampleDataSource;
  discoveryDataSource: MetricDiscoveryDataSource;
  onSave: (input: MetricRuleInput) => void;
  onCancel: () => void;
}
type SampleState = { status: "idle" | "loading" } | { status: "error"; message: string } | {
  status: "ready"; samples: MetricSample[]; hasMore: boolean; service: string; name: string; fetchedAt: string;
};

export function AlertRuleForm({ initial, applications, editing = false, busy, error, sampleDataSource, discoveryDataSource, onSave, onCancel }: AlertRuleFormProps) {
  const config = initial?.config;
  const [values, setValues] = useState<RuleFormValues>(() => ({ applicationId: initial?.applicationId ?? applications.find((item) => item.status === "active")?.id ?? "", name: initial?.name ?? "", service: config?.service ?? "", metricName: config?.metricName ?? "", operator: config?.operator ?? ">", threshold: config ? String(config.threshold) : "", windowMinutes: String(config?.windowMinutes ?? 5), recoveryWindowMinutes: String(config?.recoveryWindowMinutes ?? 3), stalenessMinutes: String(config?.stalenessMinutes ?? 1) }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingInput, setPendingInput] = useState<MetricRuleInput | null>(null);
  const pendingPayload = useRef<MetricRuleInput | null>(null);
  const valuesRef = useRef(values);
  const saveButton = useRef<HTMLButtonElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const previousConfirmation = useRef(false);
  const restoreConfirmationFocus = useRef(false);
  const [samples, setSamples] = useState<SampleState>({ status: "idle" });
  const sampleController = useRef<AbortController | null>(null);
  const samplePending = useRef(false);
  const fieldRefs = useRef<Partial<Record<keyof RuleFormValues, HTMLElement>>>({});
  const advancedDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => { fieldRefs.current.name?.focus(); return () => { sampleController.current?.abort(); }; }, []);
  useEffect(() => {
    if (pendingInput) confirmationHeading.current?.focus();
    if (previousConfirmation.current && !pendingInput) restoreConfirmationFocus.current = true;
    previousConfirmation.current = Boolean(pendingInput);
    if (restoreConfirmationFocus.current && !pendingInput && !busy) {
      restoreConfirmationFocus.current = false; saveButton.current?.focus();
    }
  }, [pendingInput, busy]);
  const locked = busy || Boolean(pendingInput);
  const clearConfirmation = () => { pendingPayload.current = null; setPendingInput(null); };

  const update = (field: keyof RuleFormValues, value: string) => {
    if (busy || valuesRef.current[field] === value) return;
    clearConfirmation();
    const next = { ...valuesRef.current, [field]: value };
    if (field === "applicationId") { next.service = ""; next.metricName = ""; next.threshold = ""; }
    else if (field === "service") { next.metricName = ""; next.threshold = ""; }
    else if (field === "metricName") next.threshold = "";
    valuesRef.current = next; setValues(next);
    setErrors((previous) => ({ ...previous, [field]: "", ...(field === "applicationId" ? { service: "", metricName: "", threshold: "" } : field === "service" ? { metricName: "", threshold: "" } : field === "metricName" ? { threshold: "" } : {}) }));
    if (field === "applicationId" || field === "service" || field === "metricName") {
      sampleController.current?.abort(); samplePending.current = false; setSamples({ status: "idle" });
    }
  };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pendingPayload.current) return;
    const nextErrors = validateRuleForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const firstInvalid = Object.keys(nextErrors)[0] as keyof typeof fieldRefs.current;
      if (["recoveryWindowMinutes", "stalenessMinutes"].includes(firstInvalid) && advancedDetails.current) advancedDetails.current.open = true;
      fieldRefs.current[firstInvalid]?.focus();
      return;
    }
    const input: MetricRuleInput = { applicationId: values.applicationId, name: values.name, config: { service: values.service, metricName: values.metricName, operator: values.operator as MetricThresholdRuleConfig["operator"], threshold: Number(values.threshold), windowMinutes: Number(values.windowMinutes), recoveryWindowMinutes: Number(values.recoveryWindowMinutes), stalenessMinutes: Number(values.stalenessMinutes) } };
    if (editing) { pendingPayload.current = input; setPendingInput(input); }
    else onSave(input);
  }
  async function checkSamples() {
    if (samplePending.current || locked) return;
    const checked = validateRuleForm(values);
    if (checked.applicationId || checked.service || checked.metricName) { setErrors((previous) => ({ ...previous, applicationId: checked.applicationId, service: checked.service, metricName: checked.metricName })); return; }
    const controller = new AbortController(); sampleController.current = controller; samplePending.current = true; setSamples({ status: "loading" });
    try {
      const result = await sampleDataSource.recent(values.applicationId, values.service, values.metricName, controller.signal);
      if (!controller.signal.aborted) setSamples({ status: "ready", samples: result.data, hasMore: result.hasMore, service: values.service, name: values.metricName, fetchedAt: new Date().toISOString() });
    } catch {
      if (!controller.signal.aborted) setSamples({ status: "error", message: "Recent readings could not be loaded. You can still save the rule disabled, but check that the metric is sending data before enabling it." });
    } finally { if (sampleController.current === controller) samplePending.current = false; }
  }
  const field = (key: keyof RuleFormValues, label: string, hint?: string) => <div>
    <label htmlFor={`rule-${key}`} className="block text-xs font-bold text-slate">{label}</label>
    <input ref={(node) => { if (node) fieldRefs.current[key] = node; else delete fieldRefs.current[key]; }} id={`rule-${key}`} type="text" inputMode={["threshold", "windowMinutes", "recoveryWindowMinutes", "stalenessMinutes"].includes(key) ? "decimal" : undefined} value={values[key]} onChange={(event) => update(key, event.target.value)} disabled={locked} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `rule-${key}-error` : hint ? `rule-${key}-hint` : undefined} className={control} />
    {hint && <p id={`rule-${key}-hint`} className="mt-1 text-xs leading-5 text-slate">{hint}</p>}
    {errors[key] && <p id={`rule-${key}-error`} className="mt-1 text-xs text-incident">{errors[key]}</p>}
  </div>;
  const loaded = samples.status === "ready" ? samples.samples : [];
  const units = [...new Set(loaded.map((sample) => sample.unit === undefined || sample.unit === "" ? null : sample.unit))];
  const types = [...new Set(loaded.map((sample) => sample.type))];
  return <form onSubmit={submit} onKeyDown={(event) => {
    if (event.key === "Escape" && pendingPayload.current) { event.preventDefault(); event.stopPropagation(); clearConfirmation(); }
  }} noValidate aria-labelledby="rule-form-title" className="mt-6 rounded-xl border border-steel bg-surface p-5 shadow-panel sm:p-6">
    <h2 id="rule-form-title" className="text-lg font-extrabold">{editing ? "Edit alert rule" : "New alert rule"}</h2>
    <p className="mt-2 text-sm leading-6 text-slate">Choose a service, a metric to monitor, and a threshold value. New and updated rules start disabled.</p>
    <div className="mt-5 grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">{field("name", "Rule name")}</div>
      <div className="sm:col-span-2"><label htmlFor="rule-applicationId" className="block text-xs font-bold text-slate">Application</label>
        <select ref={(node) => { if (node) fieldRefs.current.applicationId = node; else delete fieldRefs.current.applicationId; }}
          id="rule-applicationId" value={values.applicationId} disabled={locked || editing}
          aria-invalid={!!errors.applicationId} aria-describedby={errors.applicationId ? "rule-applicationId-error" : "rule-applicationId-hint"}
          onChange={(event) => update("applicationId", event.target.value)} className={control}>
          <option value="">Choose an application</option>
          {applications.map((application) => <option key={application.id} value={application.id} disabled={application.status !== "active" && application.id !== values.applicationId}>{application.name}{application.status === "disabled" ? " - disabled" : ""}</option>)}
        </select><p id="rule-applicationId-hint" className="mt-1 text-xs text-slate">{editing ? "The application stays fixed when a rule is replaced." : "Only telemetry from this application is checked."}</p>
        {errors.applicationId && <p id="rule-applicationId-error" className="mt-1 text-xs text-incident">{errors.applicationId}</p>}
      </div>
      <MetricRuleSelectors applicationId={values.applicationId} service={values.service} metricName={values.metricName} initialService={config?.service} initialMetricName={config?.metricName}
        busy={locked} errors={errors} dataSource={discoveryDataSource} onServiceChange={(value) => update("service", value)}
        onMetricChange={(value, expectedService) => { if (valuesRef.current.service === expectedService) update("metricName", value); }}
        serviceRef={(node) => { if (node) fieldRefs.current.service = node; else delete fieldRefs.current.service; }}
        metricRef={(node) => { if (node) fieldRefs.current.metricName = node; else delete fieldRefs.current.metricName; }} />
      <div><label htmlFor="rule-operator" className="block text-xs font-bold text-slate">Alert when the value is</label><select ref={(node) => { if (node) fieldRefs.current.operator = node; else delete fieldRefs.current.operator; }} id="rule-operator" value={values.operator} disabled={locked} onChange={(event) => update("operator", event.target.value)} className={control}>{[">", ">=", "<", "<="].map((operator) => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}</select></div>
      {field("threshold", "Threshold", "Use the metric's own unit, such as milliseconds. Values are not converted.")}{field("windowMinutes", "Time window (minutes)", "One reading from this recent time window can trigger an alert.")}
    </div>
    <details ref={advancedDetails} id="rule-advanced-settings" className="mt-5 rounded-lg border border-steel p-4"><summary className="cursor-pointer text-sm font-bold">Advanced settings and how rules work</summary><div className="mt-4 grid gap-5 sm:grid-cols-2">{field("recoveryWindowMinutes", "Recovery time window (minutes)", "Automatic recovery needs at least one reading in this window, and all readings checked must be outside the alert condition.")}{field("stalenessMinutes", "Latest reading age limit (minutes)", "Automatic recovery needs the latest reading to be no older than this.")}</div>
      <p className="mt-3 text-xs leading-5 text-slate">One reading that meets the threshold condition can trigger an alert. Readings are not averaged, and the condition does not need to last for the whole time window. Each check uses at most 500 readings. Counters are running totals, not rates per second. For a simple threshold, use a gauge: a measurement at a point in time.</p>
      <p className="mt-2 text-xs leading-5 text-slate">Automatic alert recovery must be enabled in the platform setup. These settings do not turn it on.</p>
      <p className="mt-2 text-xs leading-5 text-slate">Saving edits keeps the original rule and its past alerts, and creates a new disabled rule. Disabling a rule does not resolve existing alerts or stop a check already in progress.</p>
    </details>
    <section aria-label="Recent metric readings" className="mt-5 rounded-lg border border-steel p-4">
      <button type="button" className={button} disabled={locked || samples.status === "loading"} onClick={checkSamples}>{samples.status === "loading" ? "Checking readings..." : "Check recent readings"}</button>
      <p className="mt-2 text-xs leading-5 text-slate">See readings from the last 15 minutes. This does not guarantee new readings will arrive.</p>
      {samples.status === "loading" && <p role="status" className="mt-3 text-sm">Loading recent readings...</p>}
      {samples.status === "error" && <p role="alert" className="mt-3 text-sm text-incident">{samples.message}</p>}
      {samples.status === "ready" && <>
        <p role="status" className="mt-3 break-all text-xs text-slate">{loaded.length} readings loaded for {samples.service} / {samples.name}. Checked {formatDateTime(samples.fetchedAt)}; some readings may be old.</p>
        {loaded.length === 0 ? <p className="mt-2 text-sm">No recent readings found. Check the application connection and exact service and metric names. An empty list does not prove the metric is missing.</p> : <>
          {types.some((type) => type !== "gauge") && <p className="mt-3 text-sm text-incident">These readings include types other than gauge ({types.join(", ")}). A gauge is a measurement at a point in time. Counters are running totals, not rates per second, and can stay above a threshold. Rules are not limited to gauges, so check the metric type before enabling.</p>}
          {units.includes(null) && <p className="mt-2 text-sm text-slate">Some readings have no unit. Check what the metric measures before enabling the rule.</p>}
          {units.length > 1 && <p className="mt-2 text-sm text-incident">Different units found: {units.map((unit) => unit === null ? "(not provided)" : JSON.stringify(unit)).join(", ")}. Values are not converted. Check how your application records this metric before comparing them.</p>}
          {samples.hasMore && <p className="mt-2 text-sm text-slate">More readings are available; this check shows only part of them.</p>}
          <ul className="mt-3 max-h-64 space-y-2 overflow-auto">{loaded.map((sample, index) => <li key={`${sample.timestamp}-${index}`} className="break-all rounded border border-steel p-2 text-xs"><strong>{String(sample.value)}</strong> {sample.unit || "unit not provided"} <span className="text-slate">({sample.type})</span> - <time dateTime={sample.timestamp}>{formatDateTime(sample.timestamp)}</time></li>)}</ul>
        </>}
      </>}
    </section>
    {pendingInput && <div role="group" aria-label="Confirm rule changes" className="mt-5 rounded-lg border border-steel bg-canvas p-4">
      <h3 ref={confirmationHeading} tabIndex={-1} id="rule-save-confirmation-title" className="font-bold focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-ink">Save these changes?</h3>
      <p className="mt-2 text-sm leading-6">The previous rule will be disabled; its alerts stay unchanged. The updated rule starts disabled until you enable it.</p>
      <div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={busy} className={`${button} bg-ink text-white`} onClick={() => {
        const input = pendingPayload.current; if (busy || !input) return; pendingPayload.current = null; setPendingInput(null); onSave(input);
      }}>Confirm save</button><button type="button" disabled={busy} className={button} onClick={clearConfirmation}>Keep editing</button></div>
    </div>}
    {(error || Object.values(errors).some(Boolean)) && <p role="alert" className="mt-4 text-sm text-incident">{error || "Review the highlighted fields before saving."}</p>}
    {busy && <p role="status" className="mt-4 text-sm text-slate">Saving. Please wait...</p>}
    <div className="mt-5 flex flex-wrap gap-3"><button ref={saveButton} type="submit" disabled={locked} className={`${button} bg-ink text-white`}>{busy ? "Saving..." : editing ? "Save changes" : "Create rule"}</button><button type="button" onClick={onCancel} disabled={busy} className={button}>Cancel</button></div>
  </form>;
}
