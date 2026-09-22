import { useMemo } from "react";
import { Boxes, Link2, Network, Waypoints } from "lucide-react";
import { InvestigationDetailSection } from "./InvestigationDetailSection";
import { FindingReferenceList } from "./FindingReferences";
import { ExactIdentifiers } from "./ExactIdentifiers";
import { formatTime, humanize } from "../lib/formatters";
import { buildFindingLookup, resolveFindingIds } from "../lib/correlations";
import {
  buildCorrelationLookup,
  correlationTypeLabels,
  resolveEvidenceGroupCorrelations,
} from "../lib/evidenceGroups";
import type {
  InvestigationCorrelation,
  InvestigationEvidenceGroup,
  InvestigationFinding,
} from "../types/investigation";

interface EvidenceGroupsProps {
  evidenceGroups?: InvestigationEvidenceGroup[];
  correlations?: InvestigationCorrelation[];
  findings: InvestigationFinding[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  grouped?: boolean;
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  onNavigateFinding?: (findingId: string) => void;
}

export function EvidenceGroups({
  evidenceGroups,
  correlations,
  findings,
  selectedGroupId,
  onSelectGroup,
  grouped = false,
  detailsOpen,
  onDetailsOpenChange,
  onNavigateFinding,
}: EvidenceGroupsProps) {
  const findingsById = useMemo(() => buildFindingLookup(findings), [findings]);
  const correlationsById = useMemo(
    () => buildCorrelationLookup(correlations ?? []),
    [correlations],
  );
  const groups = evidenceGroups ?? [];
  const connectedFindingCount = groups.reduce(
    (total, group) => total + group.findingCount,
    0,
  );

  return (
    <InvestigationDetailSection
      id="evidence-groups"
      eyebrow="Connected findings"
      title="Grouped evidence"
      description={
        groups.length === 0
          ? "No connected evidence groups were found."
          : `${groups.length} ${groups.length === 1 ? "group" : "groups"} · ${connectedFindingCount} connected ${connectedFindingCount === 1 ? "finding" : "findings"}.`
      }
      count={groups.length}
      Icon={Boxes}
      actionLabel="View groups"
      drawerDescription="All recorded group details, connections, services, and linked findings."
      grouped={grouped}
      open={detailsOpen}
      onOpenChange={onDetailsOpenChange}
      preview={
        groups.length > 0 ? (
          <p className="truncate text-xs font-semibold text-ink" title={groups[0].message}>
            {groups[0].message}
            {groups.length > 1 ? ` · +${groups.length - 1} more` : ""}
          </p>
        ) : undefined
      }
    >
      {groups.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-slate">
          No connected evidence groups were found.
        </p>
      ) : (
        <ol className="space-y-4 p-4 sm:p-5">
          {groups.map((group, index) => {
            const findingReferences = resolveFindingIds(
              group.findingIds,
              findingsById,
            );
            const correlationReferences = resolveEvidenceGroupCorrelations(
              group,
              correlationsById,
            );
            const relationshipTypes = group.correlationTypes;
            const unresolvedCorrelationIds = correlationReferences
              .filter(({ correlation }) => !correlation)
              .map(({ id }) => id);
            const selected = selectedGroupId === group.id;
            const headingId = `evidence-group-heading-${index}`;

            return (
              <li key={group.id}>
                <article
                  aria-labelledby={headingId}
                  className={`rounded-lg border p-4 transition-colors ${
                    selected
                      ? "border-ink bg-canvas ring-1 ring-inset ring-ink"
                      : "border-steel bg-canvas/40"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-steel bg-surface text-slate">
                        <Network className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 id={headingId} className="break-words text-sm font-extrabold text-ink [overflow-wrap:anywhere]">
                          {group.message}
                        </h3>
                        <ExactIdentifiers className="mt-2" summary="Group ID" identifiers={[{ label: "Evidence group ID", value: group.id }]} />
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelectGroup(selected ? null : group.id)}
                      className="rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink hover:border-slate/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      {selected ? "Clear highlight" : "Highlight findings"}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-md border border-steel bg-surface px-2 py-1 text-xs font-bold text-ink">
                      {group.findingCount} {group.findingCount === 1 ? "finding" : "findings"}
                    </span>
                    <span className="rounded-md border border-steel bg-surface px-2 py-1 text-xs font-bold text-ink">
                      {group.correlationCount} {group.correlationCount === 1 ? "connection" : "connections"}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-4 border-t border-steel pt-4 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate">Finding types</p>
                      <p className="mt-2 break-words text-xs font-semibold leading-5 text-ink">
                        {group.findingTypes.length > 0
                          ? group.findingTypes.map(humanize).join(" · ")
                          : "No finding types listed."}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate">Observed window</p>
                      <p className="mt-2 font-mono text-xs leading-5 text-slate">
                        <time dateTime={group.startedAt}>{formatTime(group.startedAt)}</time>
                        <span className="mx-1.5" aria-hidden="true">→</span>
                        <time dateTime={group.endedAt}>{formatTime(group.endedAt)}</time>
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 border-t border-steel pt-4 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate">Services</p>
                      {group.services.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {group.services.map((service) => (
                            <li key={service} className="max-w-full break-all rounded bg-surface px-2 py-1 font-mono text-xs font-semibold text-ink">
                              {service}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-slate">No services listed.</p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.12em] text-slate">
                        <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />
                        Traces
                      </p>
                      {group.traceIds.length > 0 ? (
                        <ul className="mt-2 space-y-1.5">
                          {group.traceIds.map((traceId) => (
                            <li key={traceId}>
                              <ExactIdentifiers summary="Trace ID" identifiers={[{ label: "Trace ID", value: traceId }]} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-slate">No linked traces.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.12em] text-slate">
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Connections
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {relationshipTypes.map((type) => (
                        <span key={type} className="rounded-md border border-steel bg-surface px-2 py-1 text-xs font-bold text-ink">
                          {correlationTypeLabels[type]}
                        </span>
                      ))}
                      {unresolvedCorrelationIds.map((id) => (
                        <span key={id} title={id} className="rounded-md border border-dashed border-steel bg-surface px-2 py-1 text-xs font-semibold text-slate">
                          Linked connection unavailable
                        </span>
                      ))}
                      {relationshipTypes.length === 0 && unresolvedCorrelationIds.length === 0 && (
                        <span className="text-xs text-slate">No linked connections.</span>
                      )}
                    </div>
                    <ExactIdentifiers
                      className="mt-2"
                      summary="Unavailable connection IDs"
                      identifiers={unresolvedCorrelationIds.map((id) => ({ label: "Connection ID", value: id }))}
                    />
                  </div>

                  <div className="mt-4">
                    <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate">Linked findings</p>
                    <FindingReferenceList
                      references={findingReferences}
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
