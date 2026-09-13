import { useMemo } from "react";
import { ArrowRight, Layers3 } from "lucide-react";
import { findingDomId, buildFindingLookup } from "../lib/correlations";
import { correlationTypeLabels } from "../lib/evidenceGroups";
import { humanize } from "../lib/formatters";
import { signalTypeLabels } from "./StructuralSignals";
import type {
  InvestigationEvidenceRank,
  InvestigationFinding,
  InvestigationFindingSeverity,
} from "../types/investigation";

interface EvidencePriorityProps {
  ranks: InvestigationEvidenceRank[];
  findings: InvestigationFinding[];
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string | null) => void;
}

const severityStyles: Record<
  InvestigationFindingSeverity,
  { badge: string; rail: string }
> = {
  critical: {
    badge: "border-incident bg-incident text-white",
    rail: "border-l-incident",
  },
  high: {
    badge: "border-incident/30 bg-incident/[0.06] text-incident",
    rail: "border-l-incident/70",
  },
  warning: {
    badge: "border-ink/20 bg-canvas text-ink",
    rail: "border-l-ink/50",
  },
  info: {
    badge: "border-steel bg-canvas text-slate",
    rail: "border-l-steel",
  },
};

export function EvidencePriority({
  ranks,
  findings,
  selectedFindingId,
  onSelectFinding,
}: EvidencePriorityProps) {
  const findingsById = useMemo(() => buildFindingLookup(findings), [findings]);

  return (
    <section
      id="evidence-priority"
      tabIndex={-1}
      className="mt-6 scroll-mt-20 overflow-hidden rounded-xl border border-steel bg-surface shadow-panel"
      aria-labelledby="evidence-priority-heading"
      aria-describedby="evidence-priority-description"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-steel px-5 py-4 sm:px-6">
        <div>
          <p className="flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-[0.17em] text-slate">
            <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
            Backend ordering
          </p>
          <h2 id="evidence-priority-heading" className="mt-1 text-base font-extrabold tracking-tight text-ink">
            Evidence priority
          </h2>
          <p id="evidence-priority-description" className="mt-1 max-w-2xl text-xs leading-5 text-slate">
            Severity is considered first. Structural correlation and signal support are considered second.
          </p>
        </div>
        <span className="rounded-md bg-canvas px-2 py-1 font-mono text-xs font-bold text-slate">
          {ranks.length}
        </span>
      </div>

      {ranks.length === 0 ? (
        <p className="px-6 py-5 text-sm text-slate">
          No findings were ranked for this investigation.
        </p>
      ) : (
        <ol className="divide-y divide-steel">
          {ranks.map((rank, index) => {
            const finding = findingsById.get(rank.findingId);
            const selected = selectedFindingId === rank.findingId;
            const styles = severityStyles[rank.severity];
            const correlationSupport = rank.correlationTypes.length > 0
              ? rank.correlationTypes.map((type) => correlationTypeLabels[type]).join(" · ")
              : "None";
            const signalSupport = rank.signalTypes.length > 0
              ? rank.signalTypes.map((type) => signalTypeLabels[type]).join(" · ")
              : "None";

            return (
              <li
                key={rank.findingId}
                className={`border-l-4 ${styles.rail} ${
                  selected ? "bg-canvas ring-2 ring-inset ring-ink" : ""
                }`}
              >
                <article
                  className="grid gap-3 px-4 py-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                  title={`Ordering reasons: ${rank.reasons.join("; ")}`}
                >
                  <span className="font-mono text-sm font-extrabold tabular-nums text-slate">
                    #{index + 1}
                  </span>
                  <div className="min-w-0">
                    {finding ? (
                      <>
                        <a
                          href={`#${findingDomId(finding.id)}`}
                          aria-current={selected ? "location" : undefined}
                          onClick={() => onSelectFinding(selected ? null : rank.findingId)}
                          className="break-words text-sm font-extrabold text-ink underline decoration-steel underline-offset-4 hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [overflow-wrap:anywhere]"
                        >
                          {finding.message}
                        </a>
                        <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.68rem] text-slate">
                          <span className="font-bold uppercase tracking-[0.1em]">{humanize(finding.type)}</span>
                          <span className="font-mono">{finding.service ?? "Service not specified"}</span>
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="break-all font-mono text-xs font-bold text-ink">{rank.findingId}</p>
                        <p className="mt-1 text-xs text-slate">Finding reference is not present in this response.</p>
                      </>
                    )}
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.68rem] leading-5 text-slate">
                      <span><strong className="text-ink">Correlation:</strong> {correlationSupport}</span>
                      <span><strong className="text-ink">Signals:</strong> {signalSupport}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                    <span className={`rounded-md border px-2 py-1 text-[0.65rem] font-extrabold uppercase tracking-[0.1em] ${styles.badge}`}>
                      {rank.severity}
                    </span>
                    <span className="rounded-md border border-steel bg-surface px-2 py-1 font-mono text-xs font-extrabold text-ink">
                      Support {rank.supportScore}
                    </span>
                    {finding && (
                      <a
                        href={`#${findingDomId(finding.id)}`}
                        onClick={() => onSelectFinding(rank.findingId)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-slate hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                      >
                        View
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}