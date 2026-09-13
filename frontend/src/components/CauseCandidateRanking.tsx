import { useMemo, useState } from "react";
import { Equal, GitBranch, ListOrdered, Waypoints } from "lucide-react";
import { FindingReferenceList } from "./FindingReferences";
import { InvestigationDetailDrawer } from "./InvestigationDetailSection";
import {
  joinCauseCandidateRanking,
  tracePositionPresentations,
} from "../lib/causeCandidates";
import { buildFindingLookup, resolveFindingIds } from "../lib/correlations";
import { buildInvestigationDecision } from "../lib/investigationDecision";
import { traceDomId } from "../lib/investigationTargets";
import type {
  InvestigationCauseCandidate,
  InvestigationCauseCandidateFacts,
  InvestigationCauseCandidateRank,
  InvestigationCorrelation,
  InvestigationFinding,
  InvestigationFindingSeverity,
  InvestigationSignal,
} from "../types/investigation";

interface CauseCandidateRankingProps {
  candidates: InvestigationCauseCandidate[];
  facts: InvestigationCauseCandidateFacts[];
  ranks: InvestigationCauseCandidateRank[];
  findings: InvestigationFinding[];
  correlations: InvestigationCorrelation[];
  signals: InvestigationSignal[];
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string | null) => void;
  onOpenFinding?: (findingId: string) => void;
}

const severityStyles: Record<InvestigationFindingSeverity, string> = {
  critical: "border-incident bg-incident text-white",
  high: "border-incident/30 bg-incident/[0.06] text-incident",
  warning: "border-ink/20 bg-canvas text-ink",
  info: "border-steel bg-canvas text-slate",
};

export function CauseCandidateRanking({
  candidates,
  facts,
  ranks,
  findings,
  correlations,
  signals,
  selectedCandidateId,
  onSelectCandidate,
  onOpenFinding,
}: CauseCandidateRankingProps) {
  const joined = useMemo(
    () => joinCauseCandidateRanking(ranks, candidates, facts),
    [ranks, candidates, facts],
  );
  const findingsById = useMemo(() => buildFindingLookup(findings), [findings]);
  const decision = useMemo(
    () =>
      buildInvestigationDecision(
        ranks,
        candidates,
        findings,
        correlations,
        signals,
      ),
    [ranks, candidates, findings, correlations, signals],
  );
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(null);
  const activeDetails = joined.find(
    ({ rank }) => rank.candidateId === detailCandidateId,
  );
  const hasTies = ranks.some((rank) => rank.tied);

  return (
    <section
      id="candidate-ranking"
      tabIndex={-1}
      className="mt-6 scroll-mt-20 overflow-hidden rounded-xl border border-steel bg-surface shadow-panel"
      aria-labelledby="cause-candidates-heading"
      aria-describedby="cause-candidates-description"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-steel px-5 py-4 sm:px-6">
        <div>
          <p className="flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-[0.17em] text-slate">
            <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
            Deterministic priority
          </p>
          <h2
            id="cause-candidates-heading"
            className="mt-1 text-base font-extrabold tracking-tight text-ink"
          >
            Cause candidate ranking
          </h2>
          <p
            id="cause-candidates-description"
            className="mt-1 max-w-3xl text-xs leading-5 text-slate"
          >
            Backend order using failure severity, trace position, structural
            support, and failure count. Ranking guides investigation; it does not
            confirm cause.
          </p>
          {hasTies && (
            <p className="mt-1 text-xs font-semibold leading-5 text-ink">
              Equal ranks are co-equal; row order does not break the tie.
            </p>
          )}
        </div>
        <span className="rounded-md bg-canvas px-2 py-1 font-mono text-xs font-bold text-slate">
          {ranks.length}
        </span>
      </div>

      {joined.length === 0 ? (
        <p className="px-6 py-5 text-sm text-slate">
          No possible failure origins were ranked for this investigation.
        </p>
      ) : (
        <>
          <div className="border-b border-steel bg-canvas/50 px-5 py-3.5 sm:px-6">
            <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.13em] text-slate">
              {decision.coLeading
                ? "Co-leading investigation starting points"
                : "Strongest investigation starting point"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate">
              Backend-ranked guidance from observed evidence. This remains
              investigation guidance, not a causal conclusion.
            </p>
          </div>
          <ol className="divide-y divide-steel">
          {joined.map(({ rank, facts: candidateFacts }) => {
            const selected = selectedCandidateId === rank.candidateId;
            const detailsExpanded = detailCandidateId === rank.candidateId;
            const tracePosition = tracePositionPresentations[rank.tracePosition];
            const isLeading = decision.leadingCandidateIds.has(rank.candidateId);
            const decisionEvidence =
              decision.evidenceByCandidateId.get(rank.candidateId) ?? [];

            return (
              <li
                key={rank.candidateId}
                className={`${isLeading ? "bg-canvas/35" : ""} ${
                  selected ? "bg-canvas ring-2 ring-inset ring-ink" : ""
                }`}
              >
                <article
                  className="grid gap-3 px-4 py-3.5 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                  aria-label={`Rank ${rank.rank}, ${rank.service}${
                    rank.tied ? ", co-equal candidate" : ""
                  }`}
                >
                  <span className="font-mono text-sm font-extrabold tabular-nums text-slate">
                    #{rank.rank}
                  </span>

                  <div className="min-w-0">
                    {isLeading && (
                      <p className="mb-1.5 text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-slate">
                        {decision.coLeading ? "Co-leading candidate" : "Start here"}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-sm font-extrabold text-ink [overflow-wrap:anywhere]">
                        {rank.service}
                      </h3>
                      {rank.tied && (
                        <span className="inline-flex items-center gap-1 rounded border border-ink/20 bg-canvas px-1.5 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-[0.1em] text-ink">
                          <Equal className="h-3 w-3" aria-hidden="true" />
                          Co-equal candidate
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {candidateFacts ? (
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[0.62rem] font-extrabold uppercase tracking-[0.1em] ${severityStyles[candidateFacts.highestSeverity]}`}
                        >
                          {candidateFacts.highestSeverity}
                        </span>
                      ) : (
                        <span className="text-slate">Severity unavailable</span>
                      )}
                      <span className="inline-flex items-center gap-1.5 font-semibold text-ink" title={tracePosition.explanation}>
                        <GitBranch className="h-3.5 w-3.5 text-slate" aria-hidden="true" />
                        {tracePosition.label}
                      </span>
                    </div>

                    <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.7rem] font-bold text-slate">
                      <span>
                        Support {candidateFacts?.supportDiversity ?? rank.supportDiversity}
                      </span>
                      <span>
                        {candidateFacts?.failureFindingCount ?? rank.failureFindingCount}{" "}
                        {(candidateFacts?.failureFindingCount ?? rank.failureFindingCount) === 1
                          ? "failure"
                          : "failures"}
                      </span>
                    </p>

                    {isLeading && (
                      <div className="mt-3 border-t border-steel pt-3">
                        <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-slate">
                          {decision.coLeading
                            ? "Why this candidate is co-leading"
                            : "Why investigate here"}
                        </p>
                        <ul className="mt-1.5 space-y-1 text-xs leading-5 text-ink">
                          {rank.reasons.map((reason) => (
                            <li key={reason} className="flex gap-2">
                              <span className="text-steel" aria-hidden="true">—</span>
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>

                        {decisionEvidence.length > 0 && (
                          <div
                            className="mt-2.5 flex flex-wrap gap-1.5"
                            aria-label={`Supporting evidence for ${rank.service}`}
                          >
                            {decisionEvidence.map((evidence) => (
                              <span
                                key={evidence.kind}
                                className="rounded-md border border-steel bg-surface px-2 py-1 text-[0.65rem] font-bold text-ink"
                              >
                                {evidence.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    aria-expanded={detailsExpanded}
                    aria-controls="candidate-detail-drawer"
                    onClick={() => setDetailCandidateId(rank.candidateId)}
                    className="inline-flex items-center justify-center rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:justify-self-end"
                  >
                    View details
                  </button>
                </article>
              </li>
            );
          })}
          </ol>
        </>
      )}

      <InvestigationDetailDrawer
        id="candidate-detail-drawer"
        open={Boolean(activeDetails)}
        eyebrow="Deterministic candidate"
        title={
          activeDetails
            ? `Rank ${activeDetails.rank.rank} · ${activeDetails.rank.service}`
            : "Candidate details"
        }
        description="Ranking facts and evidence references from the investigation response."
        onClose={() => setDetailCandidateId(null)}
      >
        {activeDetails && (() => {
          const { rank, candidate, facts: candidateFacts } = activeDetails;
          const tracePosition = tracePositionPresentations[rank.tracePosition];
          const findingReferences = resolveFindingIds(
            candidate?.findingIds ?? [],
            findingsById,
          );
          const selected = selectedCandidateId === rank.candidateId;

          return (
            <div className="p-5 sm:p-6">
              {rank.tied && (
                <p className="inline-flex items-center gap-1 rounded-md border border-ink/20 bg-canvas px-2 py-1 text-[0.65rem] font-extrabold uppercase tracking-[0.1em] text-ink">
                  <Equal className="h-3.5 w-3.5" aria-hidden="true" />
                  Co-equal candidate
                </p>
              )}

              {candidateFacts ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-4 rounded-lg border border-steel bg-canvas/60 p-4">
                  <div>
                    <dt className="text-[0.62rem] font-extrabold uppercase tracking-[0.1em] text-slate">
                      Failure severity
                    </dt>
                    <dd className="mt-1">
                      <span className={`inline-flex rounded-md border px-2 py-1 text-[0.65rem] font-extrabold uppercase tracking-[0.1em] ${severityStyles[candidateFacts.highestSeverity]}`}>
                        {candidateFacts.highestSeverity}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.62rem] font-extrabold uppercase tracking-[0.1em] text-slate">
                      Trace position
                    </dt>
                    <dd className="mt-1 inline-flex items-center gap-1.5 text-xs font-extrabold text-ink">
                      <GitBranch className="h-3.5 w-3.5 text-slate" aria-hidden="true" />
                      {tracePosition.label}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.62rem] font-extrabold uppercase tracking-[0.1em] text-slate">
                      Support diversity
                    </dt>
                    <dd className="mt-1 font-mono text-sm font-extrabold text-ink">
                      {candidateFacts.supportDiversity}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.62rem] font-extrabold uppercase tracking-[0.1em] text-slate">
                      Failure findings
                    </dt>
                    <dd className="mt-1 font-mono text-sm font-extrabold text-ink">
                      {candidateFacts.failureFindingCount}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="rounded-md border border-dashed border-steel bg-canvas px-3 py-2 text-xs text-slate">
                  Candidate facts are not present for this ranked item.
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-lg text-xs leading-5 text-slate">
                  {tracePosition.explanation} Support counts unique correlation and
                  signal types. Failure count includes log and trace failure findings.
                </p>
                {candidate && (
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      onSelectCandidate(selected ? null : rank.candidateId);
                      setDetailCandidateId(null);
                      if (!selected && candidate.findingIds[0]) {
                        onOpenFinding?.(candidate.findingIds[0]);
                      }
                    }}
                    className="rounded-md border border-steel bg-surface px-2.5 py-1.5 text-xs font-extrabold text-ink hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    {selected ? "Clear emphasis" : "Show candidate findings"}
                  </button>
                )}
              </div>

              <section className="mt-5 border-t border-steel pt-5">
                <h3 className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate">
                  Ranking reasons
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm leading-5 text-ink">
                  {rank.reasons.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span className="text-steel" aria-hidden="true">—</span>
                      <span className="break-words [overflow-wrap:anywhere]">{reason}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {candidate ? (
                <section className="mt-5 border-t border-steel pt-5">
                  <h3 className="text-sm font-extrabold text-ink">Candidate evidence</h3>
                  <p className="mt-3 text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-slate">
                    Referenced findings
                  </p>
                  <FindingReferenceList
                    references={findingReferences}
                    onNavigateFinding={(findingId) => {
                      onSelectCandidate(rank.candidateId);
                      setDetailCandidateId(null);
                      onOpenFinding?.(findingId);
                    }}
                  />

                  {candidate.traceIds.length > 0 && (
                    <div className="mt-4">
                      <p className="flex items-center gap-1.5 text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-slate">
                        <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />
                        Referenced traces
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {candidate.traceIds.map((traceId) => (
                          <li key={traceId}>
                            <a
                              href={`#${traceDomId(traceId)}`}
                              onClick={() => setDetailCandidateId(null)}
                              className="break-all font-mono text-[0.7rem] font-semibold text-slate underline decoration-steel underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                            >
                              {traceId}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {candidate.reasons.length > 0 && (
                    <ul className="mt-4 space-y-1 text-xs leading-5 text-slate">
                      {candidate.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : (
                <p className="mt-5 border-t border-steel pt-5 text-xs text-slate">
                  Candidate evidence is not present for this ranked item.
                </p>
              )}
            </div>
          );
        })()}
      </InvestigationDetailDrawer>
    </section>
  );
}
