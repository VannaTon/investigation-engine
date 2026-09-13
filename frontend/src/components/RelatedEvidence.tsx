import { useMemo } from "react";
import { Clock3, Link2, Network, Waypoints } from "lucide-react";
import {
  buildFindingLookup,
  resolveCorrelationFindings,
} from "../lib/correlations";
import { InvestigationDetailSection } from "./InvestigationDetailSection";
import { FindingReferenceList } from "./FindingReferences";
import type {
  InvestigationCorrelation,
  InvestigationCorrelationType,
  InvestigationFinding,
} from "../types/investigation";

interface RelatedEvidenceProps {
  correlations?: InvestigationCorrelation[];
  findings: InvestigationFinding[];
  selectedCorrelationId: string | null;
  onSelectCorrelation: (correlationId: string | null) => void;
  grouped?: boolean;
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  onNavigateFinding?: (findingId: string) => void;
}

const correlationPresentation: Record<
  InvestigationCorrelationType,
  { label: string; explanation: string; Icon: typeof Link2 }
> = {
  same_span: {
    label: "Same span",
    explanation: "These findings reference the same execution span.",
    Icon: Link2,
  },
  same_trace: {
    label: "Same trace",
    explanation: "These findings occurred within the same distributed trace.",
    Icon: Waypoints,
  },
  temporal_service: {
    label: "Same service and time window",
    explanation: "These findings occurred on the same service within a short time window.",
    Icon: Clock3,
  },
};

export function RelatedEvidence({
  correlations,
  findings,
  selectedCorrelationId,
  onSelectCorrelation,
  grouped = false,
  detailsOpen,
  onDetailsOpenChange,
  onNavigateFinding,
}: RelatedEvidenceProps) {
  const findingsById = useMemo(() => buildFindingLookup(findings), [findings]);
  const items = correlations ?? [];
  const relationshipTypes = [...new Set(items.map((item) => item.type))];

  return (
    <InvestigationDetailSection
      id="relationships"
      eyebrow="Supporting relationships"
      title="Relationships"
      description={
        items.length === 0
          ? "No factual evidence relationships were identified."
          : `${items.length} factual ${items.length === 1 ? "relationship" : "relationships"} across shared telemetry context.`
      }
      count={items.length}
      Icon={Network}
      actionLabel="View relationships"
      drawerTitle="Related evidence"
      drawerDescription="Complete factual correlation details. Relationships do not establish cause."
      grouped={grouped}
      open={detailsOpen}
      onOpenChange={onDetailsOpenChange}
      preview={
        relationshipTypes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {relationshipTypes.map((type) => (
              <span key={type} className="rounded bg-canvas px-1.5 py-0.5 text-[0.68rem] font-semibold text-ink">
                {correlationPresentation[type].label}
              </span>
            ))}
          </div>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-slate">
          No related evidence groups were identified.
        </p>
      ) : (
        <ul className="space-y-4 p-4 sm:p-5">
          {items.map((correlation) => {
            const presentation = correlationPresentation[correlation.type];
            const references = resolveCorrelationFindings(correlation, findingsById);
            const selected = selectedCorrelationId === correlation.id;
            const Icon = presentation.Icon;

            return (
              <li key={correlation.id}>
                <article
                  className={`rounded-lg border p-4 transition-colors ${
                    selected
                      ? "border-ink bg-canvas ring-1 ring-inset ring-ink"
                      : "border-steel bg-canvas/40"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-steel bg-surface text-slate">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-extrabold text-ink">{presentation.label}</h3>
                        <p className="mt-1 text-xs leading-5 text-slate">{presentation.explanation}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelectCorrelation(selected ? null : correlation.id)}
                      className="rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink hover:border-slate/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      {selected ? "Clear emphasis" : "Emphasize findings"}
                    </button>
                  </div>

                  <p className="mt-3 break-words text-sm font-semibold leading-5 text-ink [overflow-wrap:anywhere]">
                    {correlation.message}
                  </p>

                  {(correlation.service || correlation.traceId || correlation.spanId) && (
                    <dl className="mt-3 grid gap-2 border-t border-steel pt-3 text-xs sm:grid-cols-2">
                      {correlation.service && (
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.1em] text-slate">Service</dt>
                          <dd className="mt-1 break-all font-mono font-semibold text-ink">{correlation.service}</dd>
                        </div>
                      )}
                      {correlation.traceId && (
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.1em] text-slate">Trace</dt>
                          <dd className="mt-1 break-all font-mono text-slate">{correlation.traceId}</dd>
                        </div>
                      )}
                      {correlation.spanId && (
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.1em] text-slate">Span</dt>
                          <dd className="mt-1 break-all font-mono text-slate">{correlation.spanId}</dd>
                        </div>
                      )}
                    </dl>
                  )}

                  <div className="mt-4">
                    <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-slate">
                      {references.length} connected {references.length === 1 ? "finding" : "findings"}
                    </p>
                    <FindingReferenceList
                      references={references}
                      onNavigateFinding={onNavigateFinding}
                    />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </InvestigationDetailSection>
  );
}