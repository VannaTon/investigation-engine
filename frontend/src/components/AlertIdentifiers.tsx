import type { InvestigationAlert } from "../types/investigation";

export function AlertIdentifiers({ alert }: { alert: Pick<InvestigationAlert, "id" | "ruleId"> }) {
  return (
    <details className="mt-3 min-w-0 text-sm text-slate">
      <summary className="w-fit cursor-pointer rounded font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        Alert IDs
      </summary>
      <dl className="mt-2 grid min-w-0 gap-2 text-xs">
        <div>
          <dt className="font-semibold">Alert ID</dt>
          <dd className="mt-1 break-all font-mono text-ink">{alert.id}</dd>
        </div>
        <div>
          <dt className="font-semibold">Rule ID</dt>
          <dd className="mt-1 break-all font-mono text-ink">{alert.ruleId}</dd>
        </div>
      </dl>
    </details>
  );
}
