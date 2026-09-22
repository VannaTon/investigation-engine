import { correlationTypeLabels } from "../lib/evidenceGroups";
import { signalTypeLabels } from "./StructuralSignals";
import type {
  InvestigationCorrelationType,
  InvestigationSignalType,
} from "../types/investigation";

const supportTypeDescription =
  "Adds the number of different connection types and pattern types. Each type counts once, even if it appears many times. This is not the number of findings or proof that the evidence is independent.";

export function SupportTypeCount({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <span className={className} title={supportTypeDescription}>
      {count} {count === 1 ? "type of connection or pattern" : "types of connections and patterns"}
    </span>
  );
}

export function SupportTypeBreakdown({
  correlationTypes,
  signalTypes,
}: {
  correlationTypes: readonly InvestigationCorrelationType[];
  signalTypes: readonly InvestigationSignalType[];
}) {
  return (
    <div className="mt-2 space-y-3">
      <p className="text-sm leading-5 text-slate">{supportTypeDescription}</p>
      <p className="font-mono text-xs font-bold text-ink">
        {correlationTypes.length} connection {correlationTypes.length === 1 ? "type" : "types"}
        {" + "}
        {signalTypes.length} pattern {signalTypes.length === 1 ? "type" : "types"}
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-extrabold text-ink">Connection types</dt>
          <dd className="mt-1">
            {correlationTypes.length === 0 ? (
              <p className="text-xs text-slate">None listed.</p>
            ) : (
              <ul className="space-y-2 text-xs leading-5 text-ink">
                {correlationTypes.map(type => (
                  <li key={type}>
                    {correlationTypeLabels[type]}
                    <code className="mt-0.5 block break-all text-slate">{type}</code>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-extrabold text-ink">Pattern types</dt>
          <dd className="mt-1">
            {signalTypes.length === 0 ? (
              <p className="text-xs text-slate">None listed.</p>
            ) : (
              <ul className="space-y-2 text-xs leading-5 text-ink">
                {signalTypes.map(type => (
                  <li key={type}>
                    {signalTypeLabels[type]}
                    <code className="mt-0.5 block break-all text-slate">{type}</code>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
