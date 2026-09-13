import { useMemo } from "react";
import { ArrowRight, FileSearch, Layers3, Link2, Network } from "lucide-react";
import { correlationTypeLabels } from "../lib/evidenceGroups";
import { buildInvestigationEvidenceStory } from "../lib/evidenceStory";
import { findingDomId } from "../lib/correlations";
import { formatTime, humanize } from "../lib/formatters";
import { signalTypeLabels } from "./StructuralSignals";
import type { EvidenceStoryFindingReference } from "../lib/evidenceStory";
import type {
  InvestigationCorrelation,
  InvestigationEvidenceGroup,
  InvestigationEvidenceRank,
  InvestigationFinding,
  InvestigationSignal,
} from "../types/investigation";

interface EvidenceStoryProps {
  ranks: InvestigationEvidenceRank[];
  findings: InvestigationFinding[];
  evidenceGroups: InvestigationEvidenceGroup[];
  correlations: InvestigationCorrelation[];
  signals: InvestigationSignal[];
  selectedFindingId: string | null;
  selectedGroupId: string | null;
  onReviewFinding: (findingId: string) => void;
  onReviewGroup: (groupId: string) => void;
}

const severityStyles = {
  critical: "border-incident bg-incident text-white",
  high: "border-incident/30 bg-incident/[0.06] text-incident",
  warning: "border-ink/20 bg-canvas text-ink",
  info: "border-steel bg-canvas text-slate",
};

function FindingList({
  references,
  priorityByFindingId,
  selectedFindingId,
  onReviewFinding,
}: {
  references: EvidenceStoryFindingReference[];
  priorityByFindingId: ReadonlyMap<string, number>;
  selectedFindingId: string | null;
  onReviewFinding: (findingId: string) => void;
}) {
  if (references.length === 0) {
    return <p className="mt-3 text-xs leading-5 text-slate">No finding references listed.</p>;
  }

  return (
    <ol className="mt-3 space-y-2">
      {references.map(({ id, finding, rank }) => {
        const priority = priorityByFindingId.get(id);
        if (!finding) {
          return (
            <li key={id} className="rounded-md border border-dashed border-steel bg-surface px-3 py-2">
              <p className="text-xs font-bold text-slate">Finding reference unavailable</p>
              <p className="mt-1 break-all font-mono text-[0.65rem] text-slate">{id}</p>
            </li>
          );
        }

        const selected = selectedFindingId === id;
        return (
          <li key={id}>
            <a
              href={`#${findingDomId(id)}`}
              aria-current={selected ? "location" : undefined}
              onClick={() => onReviewFinding(id)}
              className={`block rounded-md border px-3 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                selected
                  ? "border-ink bg-canvas ring-1 ring-inset ring-ink"
                  : "border-steel bg-surface hover:border-slate/60"
              }`}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                {priority !== undefined && (
                  <span className="font-mono text-[0.65rem] font-extrabold text-slate">
                    Priority #{priority}
                  </span>
                )}
                <span className={`rounded border px-1.5 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-[0.09em] ${severityStyles[finding.severity]}`}>
                  {finding.severity}
                </span>
                <span className="text-[0.62rem] font-bold uppercase tracking-[0.09em] text-slate">
                  {humanize(finding.type)}
                </span>
                {rank && (
                  <span className="ml-auto font-mono text-[0.62rem] font-bold text-slate">
                    Support {rank.supportScore}
                  </span>
                )}
              </span>
              <span className="mt-1.5 block break-words text-xs font-semibold leading-5 text-ink [overflow-wrap:anywhere]">
                {finding.message}
              </span>
              <span className="mt-1 block font-mono text-[0.65rem] text-slate">
                {finding.service ?? "Service not specified"} · {formatTime(finding.timestamp)}
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

export function EvidenceStory({
  ranks,
  findings,
  evidenceGroups,
  correlations,
  signals,
  selectedFindingId,
  selectedGroupId,
  onReviewFinding,
  onReviewGroup,
}: EvidenceStoryProps) {
  const story = useMemo(
    () =>
      buildInvestigationEvidenceStory(
        ranks,
        findings,
        evidenceGroups,
        correlations,
        signals,
      ),
    [ranks, findings, evidenceGroups, correlations, signals],
  );
  const priorityByFindingId = useMemo(
    () => new Map(ranks.map((rank, index) => [rank.findingId, index + 1])),
    [ranks],
  );
  const hasStory = story.threads.length > 0 || story.ungroupedFindings.length > 0;

  return (
    <section
      id="evidence-priority"
      tabIndex={-1}
      className="mt-6 scroll-mt-20 overflow-hidden rounded-xl border border-steel bg-surface shadow-panel"
      aria-labelledby="evidence-story-heading"
      aria-describedby="evidence-story-description"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-steel px-5 py-4 sm:px-6">
        <div>
          <p className="flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-[0.17em] text-slate">
            <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
            Evidence synthesis
          </p>
          <h2 id="evidence-story-heading" className="mt-1 text-base font-extrabold tracking-tight text-ink">
            How the observations connect
          </h2>
          <p id="evidence-story-description" className="mt-1 max-w-3xl text-xs leading-5 text-slate">
            Backend-ranked findings are organized by explicit evidence groups, relationships, and structural signals. These connections do not establish causality.
          </p>
        </div>
        <div className="flex gap-2 font-mono text-xs font-bold text-slate">
          <span className="rounded-md bg-canvas px-2 py-1">{story.threads.length} {story.threads.length === 1 ? "thread" : "threads"}</span>
          <span className="rounded-md bg-canvas px-2 py-1">{findings.length} findings</span>
        </div>
      </div>

      {!hasStory ? (
        <div className="flex min-h-40 items-center justify-center px-6 py-10 text-center">
          <p className="max-w-sm text-sm leading-6 text-slate">
            No findings or evidence groups were available for this investigation.
          </p>
        </div>
      ) : (
        <div className="space-y-5 p-4 sm:p-5">
          {story.threads.map((thread, index) => {
            const selected = selectedGroupId === thread.id;
            return (
              <article
                key={thread.id}
                data-evidence-thread={thread.id}
                className={`overflow-hidden rounded-lg border ${
                  selected
                    ? "border-ink ring-1 ring-inset ring-ink"
                    : "border-steel"
                }`}
              >
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-steel bg-canvas/50 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.14em] text-slate">
                      Evidence thread {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3 className="mt-1 break-words text-sm font-extrabold text-ink [overflow-wrap:anywhere]">
                      {thread.group.message}
                    </h3>
                    <p className="mt-1 font-mono text-[0.65rem] leading-5 text-slate">
                      <time dateTime={thread.group.startedAt}>{formatTime(thread.group.startedAt)}</time>
                      <span className="mx-1.5" aria-hidden="true">→</span>
                      <time dateTime={thread.group.endedAt}>{formatTime(thread.group.endedAt)}</time>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {thread.group.services.map((service) => (
                      <span key={service} className="rounded bg-surface px-2 py-1 font-mono text-[0.65rem] font-semibold text-ink">
                        {service}
                      </span>
                    ))}
                  </div>
                </header>

                <div className="grid divide-y divide-steel lg:grid-cols-3 lg:divide-x lg:divide-y-0">
                  <section className="min-w-0 p-4" aria-labelledby={`story-findings-${index}`}>
                    <p id={`story-findings-${index}`} className="flex items-center gap-2 text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-slate">
                      <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
                      Observed findings
                    </p>
                    <FindingList
                      references={thread.findings}
                      priorityByFindingId={priorityByFindingId}
                      selectedFindingId={selectedFindingId}
                      onReviewFinding={onReviewFinding}
                    />
                  </section>

                  <section className="min-w-0 p-4" aria-labelledby={`story-correlations-${index}`}>
                    <p id={`story-correlations-${index}`} className="flex items-center gap-2 text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-slate">
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Factual connections
                    </p>
                    {thread.correlations.length > 0 ? (
                      <ul className="mt-3 space-y-2">
                        {thread.correlations.map(({ id, correlation }) =>
                          correlation ? (
                            <li key={id} className="rounded-md border border-steel bg-surface px-3 py-2.5">
                              <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.1em] text-slate">
                                {correlationTypeLabels[correlation.type]}
                              </p>
                              <p className="mt-1 break-words text-xs font-semibold leading-5 text-ink [overflow-wrap:anywhere]">
                                {correlation.message}
                              </p>
                            </li>
                          ) : (
                            <li key={id} className="rounded-md border border-dashed border-steel bg-surface px-3 py-2.5">
                              <p className="text-xs font-bold text-slate">Relationship reference unavailable</p>
                              <p className="mt-1 break-all font-mono text-[0.65rem] text-slate">{id}</p>
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-slate">No explicit relationships listed.</p>
                    )}
                  </section>

                  <section className="min-w-0 p-4" aria-labelledby={`story-signals-${index}`}>
                    <p id={`story-signals-${index}`} className="flex items-center gap-2 text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-slate">
                      <Network className="h-3.5 w-3.5" aria-hidden="true" />
                      Structural patterns
                    </p>
                    {thread.signals.length > 0 ? (
                      <ul className="mt-3 space-y-2">
                        {thread.signals.map((signal) => (
                          <li key={signal.id} className="rounded-md border border-steel bg-surface px-3 py-2.5">
                            <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.1em] text-slate">
                              {signalTypeLabels[signal.type]}
                            </p>
                            <p className="mt-1 break-words text-xs font-semibold leading-5 text-ink [overflow-wrap:anywhere]">
                              {signal.message}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-slate">No structural signals listed.</p>
                    )}
                  </section>
                </div>

                <footer className="flex justify-end border-t border-steel bg-canvas/30 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onReviewGroup(thread.id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    Review {thread.findings.length} connected {thread.findings.length === 1 ? "finding" : "findings"}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </footer>
              </article>
            );
          })}

          {story.ungroupedFindings.length > 0 && (
            <article className="rounded-lg border border-dashed border-steel bg-canvas/30 p-4">
              <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.14em] text-slate">
                Outside explicit evidence groups
              </p>
              <h3 className="mt-1 text-sm font-extrabold text-ink">Unconnected findings</h3>
              <p className="mt-1 text-xs leading-5 text-slate">
                These findings remain visible, but the backend did not place them in an evidence group.
              </p>
              <div className="max-w-xl">
                <FindingList
                  references={story.ungroupedFindings}
                  priorityByFindingId={priorityByFindingId}
                  selectedFindingId={selectedFindingId}
                  onReviewFinding={onReviewFinding}
                />
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
