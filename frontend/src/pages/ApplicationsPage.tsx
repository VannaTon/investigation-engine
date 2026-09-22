import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApplicationRequestError } from "../data/applicationDataSource";
import { formatDateTime } from "../lib/formatters";
import type { Application, ApplicationDataSource, ApplicationIngestKey, CreatedApplicationIngestKey } from "../types/application";

const button = "rounded-md border border-steel bg-surface px-3 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";
const input = "mt-2 w-full rounded-md border border-steel bg-surface px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";
type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: Application[] };
type KeyState = { status: "idle" | "loading" } | { status: "error"; message: string } | { status: "ready"; items: ApplicationIngestKey[] };

function errorMessage(error: unknown): string {
  return error instanceof ApplicationRequestError ? error.message : "The request could not be completed. Refresh before trying again.";
}

export function collectorConfiguration(apiBaseUrl: string, key: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const encodedKey = encodeURIComponent(`Bearer ${key}`);
  return [
    "OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
    `OTEL_EXPORTER_OTLP_HEADERS=Authorization=${encodedKey}`,
    `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${base}/v1/traces`,
    `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=${base}/otlp/v1/metrics`,
    `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=${base}/otlp/v1/logs`,
  ].join("\n");
}

export function ApplicationsPage({ dataSource, apiBaseUrl }: { dataSource: ApplicationDataSource; apiBaseUrl: string }) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [keys, setKeys] = useState<KeyState>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string>();
  const [newApplicationName, setNewApplicationName] = useState("");
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedApplicationIngestKey>();
  const [pendingRevoke, setPendingRevoke] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    document.title = "Applications - Observability Platform";
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    dataSource.list(controller.signal).then((items) => {
      if (!mounted.current || controller.signal.aborted) return;
      setState({ status: "ready", items });
      setSelectedId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && mounted.current) setState({ status: "error", message: errorMessage(error) });
    });
    return () => controller.abort();
  }, [dataSource, version]);

  useEffect(() => {
    setCreatedKey(undefined);
    setPendingRevoke(undefined);
    if (!selectedId) { setKeys({ status: "idle" }); return; }
    const controller = new AbortController();
    setKeys({ status: "loading" });
    dataSource.listKeys(selectedId, controller.signal).then((items) => {
      if (!controller.signal.aborted && mounted.current) setKeys({ status: "ready", items });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && mounted.current) setKeys({ status: "error", message: errorMessage(error) });
    });
    return () => controller.abort();
  }, [dataSource, selectedId, version]);

  const selected = state.status === "ready" ? state.items.find((item) => item.id === selectedId) : undefined;
  const configuration = useMemo(() => createdKey ? collectorConfiguration(apiBaseUrl, createdKey.key) : "", [apiBaseUrl, createdKey]);

  async function createApplication(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setNotice(undefined);
    try {
      const created = await dataSource.create(newApplicationName);
      if (!mounted.current) return;
      setNewApplicationName("");
      setState((current) => current.status === "ready" ? { status: "ready", items: [created, ...current.items] } : current);
      setSelectedId(created.id);
      setNotice(`Application created: ${created.name}.`);
    } catch (error) { if (mounted.current) setNotice(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function changeStatus(application: Application) {
    if (busy) return;
    setBusy(true); setNotice(undefined);
    try {
      const updated = await dataSource.setStatus(application.id, application.status === "active" ? "disabled" : "active");
      if (!mounted.current) return;
      setState((current) => current.status === "ready"
        ? { status: "ready", items: current.items.map((item) => item.id === updated.id ? updated : item) } : current);
      setNotice(updated.status === "active" ? "Application enabled. Its active keys can send data again."
        : "Application disabled. All of its ingestion keys are now blocked.");
    } catch (error) { if (mounted.current) setNotice(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function createKey(event: FormEvent) {
    event.preventDefault();
    if (busy || !selected) return;
    setBusy(true); setNotice(undefined); setCreatedKey(undefined);
    try {
      const created = await dataSource.createKey(selected.id, newKeyName);
      if (!mounted.current) return;
      setNewKeyName(""); setCreatedKey(created);
      const metadata: ApplicationIngestKey = {
        id: created.id,
        applicationId: created.applicationId,
        name: created.name,
        prefix: created.prefix,
        createdAt: created.createdAt,
        ...(created.lastUsedAt === undefined ? {} : { lastUsedAt: created.lastUsedAt }),
        ...(created.revokedAt === undefined ? {} : { revokedAt: created.revokedAt }),
      };
      setKeys((current) => current.status === "ready" ? { status: "ready", items: [metadata, ...current.items] } : current);
      setNotice("Ingestion key created. Copy it now; the secret is shown only once.");
    } catch (error) { if (mounted.current) setNotice(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function revokeKey(keyId: string) {
    if (busy || !selected) return;
    setBusy(true); setNotice(undefined);
    try {
      await dataSource.revokeKey(selected.id, keyId);
      if (!mounted.current) return;
      setPendingRevoke(undefined); setCreatedKey(undefined);
      setVersion((current) => current + 1);
      setNotice("Key revoked. Applications using it can no longer send data.");
    } catch (error) { if (mounted.current) setNotice(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied.`); }
    catch { setNotice(`Could not copy automatically. Select and copy the ${label.toLowerCase()} manually.`); }
  }

  return <section aria-labelledby="applications-title">
    <h1 id="applications-title" className="text-2xl font-extrabold tracking-tight">Applications</h1>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate">Create one entry for each application that sends traces, metrics, or logs. Each application gets its own private ingestion key.</p>
    {notice && <p role="status" className="mt-4 rounded-lg border border-steel bg-surface p-4 text-sm leading-6">{notice}</p>}

    <form onSubmit={createApplication} className="mt-6 rounded-xl border border-steel bg-surface p-5 shadow-panel">
      <h2 className="font-extrabold">Add an application</h2>
      <label htmlFor="new-application-name" className="mt-4 block text-xs font-bold text-slate">Application name</label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input id="new-application-name" className={input} value={newApplicationName} maxLength={100} required disabled={busy}
          onChange={(event) => setNewApplicationName(event.target.value)} placeholder="Checkout service" />
        <button className={`${button} shrink-0 bg-ink text-white`} disabled={busy || !newApplicationName.trim()}>{busy ? "Saving..." : "Add application"}</button>
      </div>
    </form>

    {state.status === "loading" && <p role="status" className="mt-6 text-sm text-slate">Loading applications...</p>}
    {state.status === "error" && <div role="alert" className="mt-6 rounded-xl border border-steel bg-surface p-5"><p>{state.message}</p><button className={`${button} mt-3`} onClick={() => setVersion((value) => value + 1)}>Try again</button></div>}
    {state.status === "ready" && state.items.length === 0 && <div className="mt-6 rounded-xl border border-steel bg-surface p-6"><h2 className="font-extrabold">No applications yet</h2><p className="mt-2 text-sm text-slate">Add your first application, then create an ingestion key and copy the connection settings.</p></div>}
    {state.status === "ready" && state.items.length > 0 && <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <section aria-labelledby="application-list-title" className="rounded-xl border border-steel bg-surface p-5 shadow-panel">
        <h2 id="application-list-title" className="font-extrabold">Your applications</h2>
        <ul className="mt-4 space-y-3">{state.items.map((application) => <li key={application.id}>
          <button type="button" onClick={() => setSelectedId(application.id)}
            className={`w-full rounded-lg border p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${selectedId === application.id ? "border-ink bg-canvas" : "border-steel"}`}
            aria-current={selectedId === application.id ? "true" : undefined}>
            <span className="font-bold">{application.name}</span>
            <span className="ml-2 rounded-full border border-steel px-2 py-1 text-xs">{application.status === "active" ? "Active" : "Disabled"}</span>
            <span className="mt-2 block break-all font-mono text-xs text-slate">{application.id}</span>
          </button>
        </li>)}</ul>
      </section>

      {selected && <section aria-labelledby="connection-title" className="rounded-xl border border-steel bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="connection-title" className="font-extrabold">{selected.name} connection</h2><p className="mt-1 text-xs text-slate">Created {formatDateTime(selected.createdAt)}</p></div>
          <button type="button" className={button} disabled={busy} onClick={() => changeStatus(selected)}>{selected.status === "active" ? "Disable application" : "Enable application"}</button></div>
        <p className="mt-3 text-sm leading-6 text-slate">{selected.status === "active" ? "Active keys can send telemetry." : "All keys are blocked until this application is enabled."}</p>

        <form onSubmit={createKey} className="mt-5 border-t border-steel pt-5">
          <h3 className="font-bold">Create an ingestion key</h3>
          <p className="mt-1 text-xs leading-5 text-slate">Use a name that says where the key is installed. The secret is shown only once.</p>
          <label htmlFor="new-key-name" className="mt-3 block text-xs font-bold text-slate">Key name</label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><input id="new-key-name" className={input}
            value={newKeyName} maxLength={100} required disabled={busy || selected.status !== "active"}
            onChange={(event) => setNewKeyName(event.target.value)} placeholder="Production collector" />
            <button className={`${button} shrink-0 bg-ink text-white`} disabled={busy || selected.status !== "active" || !newKeyName.trim()}>Create key</button></div>
        </form>

        {createdKey && <div role="alert" className="mt-5 rounded-lg border-2 border-ink bg-canvas p-4">
          <h3 className="font-extrabold">Copy this key now</h3>
          <p className="mt-1 text-sm">It will not be shown again after you leave or refresh this page.</p>
          <textarea readOnly rows={3} value={createdKey.key} aria-label="New ingestion key" className={`${input} break-all font-mono text-xs`} />
          <button type="button" className={`${button} mt-3`} onClick={() => copy(createdKey.key, "Ingestion key")}>Copy key</button>
          <h4 className="mt-5 font-bold">OpenTelemetry HTTP/JSON settings</h4>
          <p className="mt-1 text-xs text-slate">Set these values in the application or collector that sends telemetry.</p>
          <textarea readOnly rows={7} value={configuration} aria-label="OpenTelemetry connection settings" className={`${input} font-mono text-xs`} />
          <button type="button" className={`${button} mt-3`} onClick={() => copy(configuration, "Connection settings")}>Copy settings</button>
          <p className="mt-3 text-xs text-slate">OTLP protobuf is not supported yet. Use <strong>http/json</strong>.</p>
        </div>}

        <div className="mt-5 border-t border-steel pt-5"><h3 className="font-bold">Keys</h3>
          {keys.status === "loading" && <p role="status" className="mt-3 text-sm text-slate">Loading keys...</p>}
          {keys.status === "error" && <p role="alert" className="mt-3 text-sm text-incident">{keys.message}</p>}
          {keys.status === "ready" && keys.items.length === 0 && <p className="mt-3 text-sm text-slate">No keys yet.</p>}
          {keys.status === "ready" && <ul className="mt-3 space-y-3">{keys.items.map((key) => <li key={key.id} className="rounded-lg border border-steel p-3">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{key.name}</p><p className="mt-1 font-mono text-xs text-slate">Key starts with op_ingest_{key.prefix}_</p><p className="mt-1 text-xs text-slate">{key.revokedAt ? `Revoked ${formatDateTime(key.revokedAt)}` : key.lastUsedAt ? `Last used ${formatDateTime(key.lastUsedAt)}` : "Not used yet"}</p></div>
              {!key.revokedAt && (pendingRevoke === key.id
                ? <div><p className="text-xs">Revoke this key?</p><div className="mt-2 flex gap-2"><button className={button} disabled={busy} onClick={() => revokeKey(key.id)}>Confirm revoke</button><button className={button} disabled={busy} onClick={() => setPendingRevoke(undefined)}>Cancel</button></div></div>
                : <button className={button} disabled={busy} onClick={() => setPendingRevoke(key.id)}>Revoke</button>)}</div>
          </li>)}</ul>}
        </div>
      </section>}
    </div>}
  </section>;
}
