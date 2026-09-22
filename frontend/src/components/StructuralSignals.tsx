import { useEffect, useMemo } from "react";
import { GitBranch, Layers3, Network } from "lucide-react";
import { InvestigationDetailSection } from "./InvestigationDetailSection";
import { FindingReferenceList } from "./FindingReferences";
import { ExactIdentifiers } from "./ExactIdentifiers";
import {
  buildFindingLookup,
  resolveFindingIds,
  signalDomId,
} from "../lib/correlations";
import type {
  InvestigationFinding,
  InvestigationSignal,
  InvestigationSignalType,
} from "../types/investigation";

export const signalTypeLabels: Record<InvestigationSignalType, string> = {
  cross_service_failure: "Failures across services",
  multi_signal_evidence: "More than one evidence type",
  trace_failure_chain: "Failures along a call path",
};

const signalIcons = {
  cross_service_failure: Network,
  multi_signal_evidence: Layers3,
  trace_failure_chain: GitBranch,
};

interface StructuralSignalsProps {
  signals: InvestigationSignal[];
  findings: InvestigationFinding[];
  selectedSignalId: string | null;
  onSelectSignal: (signalId: string | null) => void;
  grouped?: boolean;
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  onNavigateFinding?: (findingId: string) => void;
}

export function StructuralSignals({
  signals,
  findings,
  selectedSignalId,
  onSelectSignal,
  grouped = false,
  detailsOpen,
  onDetailsOpenChange,
  onNavigateFinding,
}: StructuralSignalsProps) {
  const findingsById = useMemo(() => buildFindingLookup(findings), [findings]);

  useEffect(() => {
    if (
      !detailsOpen ||
      !selectedSignalId ||
      typeof document === "undefined" ||
      typeof window === "undefined"
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(signalDomId(selectedSignalId))
        ?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailsOpen, selectedSignalId]);

  return (
    <InvestigationDetailSection
      id="structural-signals"
      eyebrow="Recorded observations"
      title="Evidence patterns"
      description={
        signals.length === 0
          ? "No evidence patterns were found."
          : `${signals.length} ${signals.length === 1 ? "pattern" : "patterns"} in the recorded evidence.`
      }
      count={signals.length}
      Icon={Layers3}
      actionLabel="View patterns"
      drawerDescription="All recorded pattern descriptions, scope, and linked findings. Patterns do not confirm cause."
      grouped={grouped}
      open={detailsOpen}
      onOpenChange={onDetailsOpenChange}
      preview={
        signals.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {signals.slice(0, 3).map((signal) => (
              <span key={signal.id} className="rounded bg-canvas px-1.5 py-0.5 text-xs font-semibold text-ink">
                {signalTypeLabels[signal.type]}
              </span>
            ))}
          </div>
        ) : undefined
      }
    >
      {signals.length === 0 ? (
        <p className="px-6 py-5 text-sm text-slate">
          No evidence patterns were found.
        </p>
      ) : (
        <ol className="space-y-4 p-4 sm:p-5">
          {signals.map((signal) => {
            const Icon = signalIcons[signal.type];
            const selected = selectedSignalId === signal.id;
            const references = resolveFindingIds(signal.findingIds, findingsById);

            return (
              <li
                id={signalDomId(signal.id)}
                key={signal.id}
                className="scroll-mt-4"
              >
                <article className={`rounded-lg border p-4 ${
                  selected
                    ? "border-ink bg-canvas ring-1 ring-inset ring-ink"
                    : "border-steel bg-canvas/40"
                }`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-steel bg-surface text-slate">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-extrabold text-ink">{signalTypeLabels[signal.type]}</h3>
                        <p className="mt-1 break-words text-xs leading-5 text-slate [overflow-wrap:anywhere]">
                          {signal.message}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelectSignal(selected ? null : signal.id)}
                      className="rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink hover:border-slate/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      {selected ? "Clear highlight" : "Highlight findings"}
                    </button>
                  </div>

                  <ExactIdentifiers
                    identifiers={[
                      { label: "Evidence group ID", value: signal.evidenceGroupId },
                      ...(signal.traceId ? [{ label: "Trace ID", value: signal.traceId }] : []),
                    ]}
                    className="mt-3 border-t border-steel pt-3"
                  />

                  {signal.services && signal.services.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {signal.services.map((service) => (
                        <span key={service} className="rounded bg-surface px-2 py-1 font-mono text-xs font-semibold text-ink">
                          {service}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-4">
                    <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate">Linked findings</p>
                    <FindingReferenceList
                      references={references}
                      onNavigateFinding={onNavigateFinding}
                    />
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </InvestigationDetailSection>
  );
}
