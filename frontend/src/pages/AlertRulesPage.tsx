import { useEffect, useRef, useState } from "react";
import { AlertRuleForm } from "../components/AlertRuleForm";
import { RuleRequestError, type AlertRuleDataSource } from "../data/alertRuleDataSource";
import type { MetricSampleDataSource } from "../data/metricSampleDataSource";
import type { MetricDiscoveryDataSource } from "../data/metricDiscoveryDataSource";
import { ApplicationRequestError } from "../data/applicationDataSource";
import { metricRuleConfig, type AlertRule, type AlertRuleEditContext, type MetricRuleInput } from "../types/alertRule";
import type { Application, ApplicationDataSource } from "../types/application";
import { formatDateTime } from "../lib/formatters";

const button = "rounded-md border border-steel bg-surface px-3 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";
type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rules: AlertRule[]; fetchedAt: string; refreshing: boolean; refreshError?: string };
type Editor = { kind: "new" } | { kind: "loading"; id: string } | { kind: "edit"; context: AlertRuleEditContext };
type ApplicationState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: Application[] };
interface AlertRulesPageProps { dataSource: AlertRuleDataSource; applicationDataSource: ApplicationDataSource; sampleDataSource: MetricSampleDataSource; discoveryDataSource: MetricDiscoveryDataSource; }
const errorMessage = (error: unknown) => error instanceof RuleRequestError ? error.message : "The request could not be completed. Refresh and review the latest rule settings.";
const applicationErrorMessage = (error: unknown) => error instanceof ApplicationRequestError ? error.message : "Applications could not be loaded.";

export function AlertRulesPage({ dataSource, applicationDataSource, sampleDataSource, discoveryDataSource }: AlertRulesPageProps) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [applicationState, setApplicationState] = useState<ApplicationState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [formError, setFormError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [writeBusy, setWriteBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const requestPending = useRef(true);
  const writePending = useRef(false);
  const editController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const explicitRefresh = useRef(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previousEditor = useRef<Editor | null>(null);
  const restoreFocusPending = useRef(false);
  useEffect(() => {
    if (previousEditor.current !== null && editor === null) restoreFocusPending.current = true;
    previousEditor.current = editor;
    if (!restoreFocusPending.current || editor || writeBusy || state.status === "loading" || state.status === "ready" && state.refreshing) return;
    restoreFocusPending.current = false;
    const target = opener.current;
    if (target?.isConnected && !(target as HTMLButtonElement).disabled) target.focus();
    else heading.current?.focus();
  }, [editor, writeBusy, state]);
  useEffect(() => {
    mounted.current = true; document.title = "Alert Rules - Observability Platform";
    return () => { mounted.current = false; editController.current?.abort(); writeController.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    requestPending.current = true;
    const isExplicit = explicitRefresh.current; explicitRefresh.current = false;
    setState((previous) => previous.status === "ready" ? { ...previous, refreshing: true, refreshError: undefined } : { status: "loading" });
    dataSource.list(controller.signal).then((rules) => {
      if (!active) return;
      requestPending.current = false; setState({ status: "ready", rules, fetchedAt: new Date().toISOString(), refreshing: false });
      if (isExplicit) setReviewReady(true);
    }).catch((error: unknown) => {
      if (!active || controller.signal.aborted) return;
      requestPending.current = false;
      setState((previous) => previous.status === "ready" ? { ...previous, refreshing: false, refreshError: errorMessage(error) } : { status: "error", message: errorMessage(error) });
    });
    return () => { active = false; controller.abort(); };
  }, [dataSource, version]);
  useEffect(() => {
    const controller = new AbortController();
    setApplicationState({ status: "loading" });
    applicationDataSource.list(controller.signal).then((items) => {
      if (!controller.signal.aborted && mounted.current) setApplicationState({ status: "ready", items });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && mounted.current) {
        setApplicationState({ status: "error", message: applicationErrorMessage(error) });
      }
    });
    return () => controller.abort();
  }, [applicationDataSource, version]);
  const applications = applicationState.status === "ready" ? applicationState.items : [];
  const listBusy = state.status === "loading" || state.status === "ready" && state.refreshing;
  const busy = listBusy || writeBusy || editor?.kind === "loading";
  function refresh() {
    if (requestPending.current || writePending.current) return;
    editController.current?.abort(); setEditor(null); setFormError(undefined);
    requestPending.current = true; explicitRefresh.current = true; setReviewReady(false); setVersion((previous) => previous + 1);
  }
  function closeEditor() {
    if (writePending.current) return;
    editController.current?.abort(); setEditor(null); setFormError(undefined);
  }
  async function openEdit(id: string, openingControl?: HTMLElement) {
    if (writePending.current || requestPending.current || uncertain) return;
    opener.current = openingControl ?? null;
    editController.current?.abort(); const controller = new AbortController(); editController.current = controller;
    setFormError(undefined); setMessage(undefined); setEditor({ kind: "loading", id });
    try {
      const context = await dataSource.editContext(id, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      if (!metricRuleConfig(context.rule)) { setEditor(null); setMessage("This rule's current settings cannot be edited here. Refresh the list."); return; }
      setEditor({ kind: "edit", context });
    } catch (error: unknown) { if (!controller.signal.aborted && mounted.current) { setEditor(null); setMessage(errorMessage(error)); } }
  }
  function updateRule(rule: AlertRule) { setState((previous) => previous.status === "ready" ? { ...previous, rules: previous.rules.map((row) => row.id === rule.id ? rule : row) } : previous); }
  async function save(input: MetricRuleInput) {
    if (writePending.current || requestPending.current || uncertain || !editor || editor.kind === "loading") return;
    const editing = editor.kind === "edit" ? editor.context : null;
    const controller = new AbortController(); writeController.current = controller; writePending.current = true;
    setWriteBusy(true); setFormError(undefined); setMessage(undefined);
    try {
      if (editing) {
        const result = await dataSource.replace(editing.rule.id, input, editing.revisionToken, controller.signal);
        if (!mounted.current) return;
        setState((previous) => previous.status === "ready" ? { ...previous, rules: [result.replacement, ...previous.rules.map((rule) => rule.id === result.previousRuleId ? { ...rule, enabled: false } : rule)] } : previous);
        setMessage("Changes saved. The updated rule is disabled. Past alerts keep their original settings. Enable the updated rule when ready.");
      } else {
        const rule = await dataSource.create(input, controller.signal);
        if (!mounted.current) return;
        setState((previous) => previous.status === "ready" ? { ...previous, rules: [rule, ...previous.rules] } : previous);
        setMessage("Rule saved. It is disabled. Enable it when ready.");
      }
      setEditor(null);
    } catch (error: unknown) {
      if (!mounted.current) return;
      if (!(error instanceof RuleRequestError) || ["uncertain", "invalid_response", "aborted"].includes(error.kind)) {
        setUncertain(true); setReviewReady(false); setEditor(null); setMessage("We could not confirm whether the change was saved. It may already be saved. Refresh the list and review the latest rules. Confirm that review before creating or editing another rule. No request will be retried automatically.");
      } else if (error.kind === "conflict" || error.kind === "not_found") { setEditor(null); setMessage(`${error.message} Refresh and choose Edit again to load the current settings.`); }
      else setFormError(errorMessage(error));
    } finally { writePending.current = false; if (mounted.current) setWriteBusy(false); }
  }
  async function toggle(rule: AlertRule) {
    if (writePending.current || requestPending.current || uncertain || editor) return;
    const controller = new AbortController(); writeController.current = controller; writePending.current = true;
    setWriteBusy(true); setMessage(undefined);
    try {
      const latest = await dataSource.setEnabled(rule.id, !rule.enabled, controller.signal);
      if (!mounted.current) return;
      updateRule(latest); setMessage(`${latest.enabled ? "Enabled" : "Disabled"} rule: ${latest.name}.${latest.enabled ? "" : " Existing alerts are unchanged."}`);
    } catch (error: unknown) {
      if (!mounted.current) return;
      if (!(error instanceof RuleRequestError) || ["uncertain", "invalid_response", "aborted"].includes(error.kind)) {
        try {
          const latest = await dataSource.get(rule.id, controller.signal);
          if (!mounted.current) return;
          updateRule(latest); setMessage(`We could not confirm the change. The latest rule is ${latest.enabled ? "enabled" : "disabled"}; review it before trying again. No update was automatically retried.`);
        } catch {
          if (mounted.current) { setUncertain(true); setReviewReady(false); setMessage("We could not confirm the change or load the latest rule settings. Refresh and review the list before making another change."); }
        }
      } else setMessage(errorMessage(error));
    } finally { writePending.current = false; if (mounted.current) setWriteBusy(false); }
  }
  return <section aria-labelledby="alert-rules-title">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 ref={heading} tabIndex={-1} id="alert-rules-title" className="text-2xl font-extrabold tracking-tight focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-ink">Alert Rules</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate">Set metric thresholds for your application. New and updated rules start disabled.</p></div><div className="flex flex-wrap gap-3"><button type="button" className={button} onClick={refresh} disabled={listBusy || writeBusy}>{listBusy && state.status === "ready" ? "Refreshing..." : "Refresh rules"}</button><button ref={newButton} type="button" className={`${button} bg-ink text-white`} disabled={busy || uncertain || !!editor || state.status !== "ready" || !!state.refreshError || applicationState.status !== "ready" || !applications.some((item) => item.status === "active")} onClick={(event) => { opener.current = event?.currentTarget ?? newButton.current; setEditor({ kind: "new" }); setFormError(undefined); setMessage(undefined); }}>New rule</button></div></div>
    <p className="mt-4 rounded-lg border border-steel bg-surface p-4 text-sm leading-6 text-slate">One metric reading that meets the threshold condition can trigger an alert. Readings are not averaged, and the condition does not need to last for the whole time window.</p>
    {applicationState.status === "loading" && <p role="status" className="mt-4 text-sm text-slate">Loading applications...</p>}
    {applicationState.status === "error" && <p role="alert" className="mt-4 rounded-lg border border-steel bg-surface p-4 text-sm">{applicationState.message} Refresh this page before creating a rule.</p>}
    {applicationState.status === "ready" && !applications.some((item) => item.status === "active") && <p className="mt-4 rounded-lg border border-steel bg-surface p-4 text-sm">Add or enable an application before creating a rule. <a className="font-bold underline" href="/applications">Open Applications</a>.</p>}
    {message && <p role="status" className="mt-4 rounded-lg border border-steel bg-surface p-4 text-sm leading-6">{message}</p>}
    {uncertain && <div role="alert" className="mt-4 rounded-lg border border-incident/30 p-4 text-sm"><p>Rule changes are paused until you refresh and review the latest rules. Check more than the rule name: different rules can have the same name.</p>{reviewReady && <button type="button" className={`${button} mt-3`} disabled={listBusy} onClick={() => { setUncertain(false); setReviewReady(false); setMessage("Latest rules reviewed. The unconfirmed change was not retried. You can now choose a new action."); }}>I reviewed the latest rule list</button>}</div>}
    {editor?.kind === "loading" && <div className="mt-6 rounded-xl border border-steel bg-surface p-5"><p role="status">Loading current rule settings...</p><button type="button" onClick={closeEditor} className={`${button} mt-3`}>Cancel</button></div>}
    {editor && editor.kind !== "loading" && <AlertRuleForm key={editor.kind === "new" ? "new" : `${editor.context.rule.id}-${editor.context.revisionToken}`} applications={applications} initial={editor.kind === "edit" ? { applicationId: editor.context.rule.applicationId, name: editor.context.rule.name, config: metricRuleConfig(editor.context.rule)! } : undefined} editing={editor.kind === "edit"} busy={writeBusy} error={formError} sampleDataSource={sampleDataSource} discoveryDataSource={discoveryDataSource} onSave={save} onCancel={closeEditor} />}
    {state.status === "loading" && <p role="status" className="mt-6 text-sm text-slate">Loading alert rules...</p>}
    {state.status === "error" && <div role="alert" className="mt-6 rounded-xl border border-steel bg-surface p-5"><h2 className="font-extrabold">Unable to load alert rules</h2><p className="mt-2 text-sm text-slate">{state.message}</p><button type="button" className={`${button} mt-4`} onClick={refresh}>Try again</button></div>}
    {state.status === "ready" && <>
      <p role="status" className="mt-5 text-xs text-slate">{state.rules.length} rules. List last loaded: <time dateTime={state.fetchedAt}>{formatDateTime(state.fetchedAt)}</time>{state.refreshing && " - Refreshing..."}</p>
      {state.refreshError && <p role="alert" className="mt-4 rounded-lg border border-steel bg-surface p-4 text-sm">{state.refreshError} The earlier rule list is still visible and may be out of date. Refresh before making changes.</p>}
      {state.rules.length === 0 ? <div className="mt-4 rounded-xl border border-steel bg-surface p-6"><h2 className="font-extrabold">No alert rules yet</h2><p className="mt-2 text-sm text-slate">Create a disabled rule, check recent metric readings, then enable it when you understand the threshold. A gauge measures a value at a point in time and suits simple thresholds.</p></div> : <ul className="mt-4 space-y-3">{state.rules.map((rule) => {
        const config = metricRuleConfig(rule); const malformedMetric = rule.type === "metric_threshold" && !config;
        return <li key={rule.id} className="min-w-0 rounded-xl border border-steel bg-surface p-5 shadow-panel"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-steel px-2 py-1 text-xs font-bold">{rule.enabled ? "Enabled" : "Disabled"}</span><span className="break-all font-mono text-xs text-slate">{rule.id}</span></div><h2 className="mt-3 break-words text-base font-extrabold [overflow-wrap:anywhere]">{rule.name}</h2>{config ? <><p className="mt-2 break-all text-sm">{config.service} / {config.metricName}</p><p className="mt-1 text-sm">Any reading checked {config.operator} {String(config.threshold)} within {config.windowMinutes} minutes</p><p className="mt-1 text-xs text-slate">Recovery window {config.recoveryWindowMinutes} min; latest reading age limit {config.stalenessMinutes} min for recovery. Units come from the application.</p></> : <p className="mt-2 text-sm text-slate">{malformedMetric ? "These metric settings cannot be used here, so editing and enabling are unavailable. If this rule is enabled, you can still disable it." : `This rule can only be viewed here. Rule type: ${rule.type}.`}</p>}<p className="mt-2 text-xs text-slate">Updated <time dateTime={rule.updatedAt}>{formatDateTime(rule.updatedAt)}</time></p></div><div className="flex flex-wrap gap-2">{config && <button type="button" className={button} aria-label={`Edit rule: ${rule.name} (${rule.id})`} disabled={busy || uncertain || !!editor || !!state.refreshError} onClick={(event) => openEdit(rule.id, event?.currentTarget)}>Edit</button>}{rule.type === "metric_threshold" && <button type="button" className={button} aria-label={`${rule.enabled ? "Disable" : "Enable"} rule: ${rule.name} (${rule.id})`} disabled={busy || uncertain || !!editor || !!state.refreshError || malformedMetric && !rule.enabled} onClick={() => toggle(rule)}>{rule.enabled ? "Disable" : "Enable"}</button>}</div></div></li>;
      })}</ul>}
    </>}
  </section>;
}
