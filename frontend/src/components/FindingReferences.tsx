import { findingDomId } from "../lib/correlations";
import { humanize } from "../lib/formatters";
import { ExactIdentifiers } from "./ExactIdentifiers";
import type { CorrelationFindingReference } from "../lib/correlations";

interface FindingReferenceListProps {
  references: CorrelationFindingReference[];
  onNavigateFinding?: (findingId: string) => void;
}

export function FindingReferenceList({
  references,
  onNavigateFinding,
}: FindingReferenceListProps) {
  return (
    <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
      {references.map(({ id, finding }) =>
        finding ? (
          <li key={id}>
            <a
              href={`#${findingDomId(finding.id)}`}
              onClick={() => onNavigateFinding?.(finding.id)}
              className="group flex items-center justify-between gap-3 rounded-md border border-steel bg-surface px-3 py-2 hover:border-slate/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <span className="min-w-0">
                <span className="block text-xs font-extrabold text-ink">
                  {humanize(finding.type)}
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-slate">
                  {finding.service ?? "Service not specified"}
                </span>
              </span>
              <span className="shrink-0 text-xs font-extrabold uppercase tracking-[0.1em] text-slate group-hover:text-ink">
                {finding.severity}
              </span>
            </a>
          </li>
        ) : (
          <li
            key={id}
            className="rounded-md border border-dashed border-steel bg-canvas px-3 py-2"
          >
            <p className="text-xs font-semibold text-slate">
              Linked finding unavailable in this investigation.
            </p>
            <ExactIdentifiers className="mt-2" summary="Finding ID" identifiers={[{ label: "Finding ID", value: id }]} />
          </li>
        ),
      )}
    </ul>
  );
}
