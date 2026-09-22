import { useEffect, useRef, useState } from "react";
import { AlertLifecycleError, type AlertAction, type AlertLifecycleDataSource } from "../data/alertLifecycleDataSource";
import type { InvestigationDataSource } from "../data/investigationDataSource";
import type { AlertInvestigationResponse, InvestigationAlert } from "../types/investigation";

const control = "rounded-md border border-steel px-3 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";
type Outcome = "saved" | "conflict" | "missing" | "rejected" | "uncertain";
interface Props {
  alert: InvestigationAlert;
  dataSource: AlertLifecycleDataSource;
  investigationSource: InvestigationDataSource;
  onUpdated: (investigation: AlertInvestigationResponse) => void;
}

export function AlertLifecycleActions({ alert, dataSource, investigationSource, onUpdated }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState(false);
  const locked = useRef(false);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const outcome = useRef<Outcome>("uncertain");
  const cancel = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLParagraphElement>(null);
  const resolveButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (confirming) cancel.current?.focus();
    else if (wasConfirming.current && !busy) resolveButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming, busy]);
  useEffect(() => { if (message && !busy) notice.current?.focus(); }, [message, busy]);

  async function refreshInvestigation() {
    setMessage(outcome.current === "saved" ? "Change saved. Refreshing investigation…" : "Checking the latest alert status…");
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 15000);
    try {
      const next = await investigationSource.getInvestigation(alert.id, { signal: controller.current.signal });
      if (!active.current) return;
      if (next.alert.id !== alert.id) throw new Error("Mismatched investigation");
      onUpdated(next);
      setNeedsRefresh(false);
      setWarning(outcome.current !== "saved");
      setMessage(outcome.current === "saved" ? "Change saved. Investigation refreshed."
        : outcome.current === "conflict" ? "The alert changed before your update finished. The latest status is shown."
        : outcome.current === "rejected" ? "The change was not accepted. The latest status is shown; check it before trying again."
        : "We could not confirm whether the change was saved. The latest alert status is shown; check it before trying again.");
    } catch {
      if (!active.current) return;
      setNeedsRefresh(true);
      setWarning(true);
      setMessage(outcome.current === "saved"
        ? "Change saved, but the investigation could not be refreshed. The displayed evidence and status may be out of date."
        : "The latest alert status could not be loaded. This page may be out of date. Refresh before trying another action.");
    } finally { clearTimeout(timer); }
  }

  async function run(action?: AlertAction) {
    if (locked.current || (action && needsRefresh)) return;
    if (action === "acknowledged" && alert.status !== "firing") return;
    if (action === "resolved" && (!confirming || alert.status === "resolved")) return;
    locked.current = true;
    setBusy(true);
    setConfirming(false);
    setWarning(false);
    try {
      if (action) {
        setMessage(action === "resolved" ? "Resolving alert…" : "Acknowledging alert…");
        controller.current = new AbortController();
        const timer = setTimeout(() => controller.current?.abort(), 15000);
        try {
          await dataSource.updateStatus(alert.id, action, controller.current.signal);
          outcome.current = "saved";
        } catch (error) {
          outcome.current = error instanceof AlertLifecycleError && error.status === 409 ? "conflict"
            : error instanceof AlertLifecycleError && error.status === 404 ? "missing"
            : error instanceof AlertLifecycleError && error.status !== undefined && error.status >= 400 && error.status < 500 ? "rejected"
            : "uncertain";
        } finally { clearTimeout(timer); }
      }
      if (active.current) await refreshInvestigation();
    } finally {
      if (active.current) { locked.current = false; setBusy(false); }
    }
  }

  return <section aria-label="Alert actions" className="my-4 rounded-xl border border-steel bg-surface p-4">
    <p className="mb-3 text-sm text-slate">Acknowledge marks the alert as seen. Resolve closes the alert.</p>
    <div className="flex flex-wrap items-center gap-3">
      {alert.status === "firing" && <button type="button" className={control} disabled={busy || needsRefresh || confirming} onClick={() => void run("acknowledged")}>Acknowledge</button>}
      {alert.status !== "resolved" && <button ref={resolveButton} type="button" className={control} disabled={busy || needsRefresh || confirming} onClick={() => setConfirming(true)}>Resolve</button>}
      {alert.status === "resolved" && <p className="text-sm text-slate">This alert is resolved.</p>}
      {needsRefresh && <button type="button" className={control} disabled={busy} onClick={() => void run()}>Refresh investigation</button>}
    </div>
    {confirming && <div role="group" aria-labelledby="resolve-confirmation" className="mt-3 rounded-lg border border-steel p-4" onKeyDown={(event) => {
      if (event.key === "Escape") { setConfirming(false); resolveButton.current?.focus(); }
    }}>
      <h2 id="resolve-confirmation" className="font-bold">Resolve this alert?</h2>
      <p className="mt-2 text-sm text-slate">This closes the alert and sets an end time for its evidence window. It does not confirm that the service has recovered.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button ref={cancel} type="button" className={control} onClick={() => { setConfirming(false); resolveButton.current?.focus(); }}>Cancel</button>
        <button type="button" className={control} onClick={() => void run("resolved")}>Resolve alert</button>
      </div>
    </div>}
    {message && <p ref={notice} tabIndex={-1} role={warning ? "alert" : "status"} className="mt-3 text-sm text-slate focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-ink">{message}</p>}
  </section>;
}
