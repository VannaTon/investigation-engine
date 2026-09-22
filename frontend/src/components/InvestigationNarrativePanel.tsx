import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Equal,
  GitBranch,
  Link2,
  LoaderCircle,
  MessageSquareText,
} from "lucide-react";
import { normalizeNarrativeApiError } from "../data/investigationNarrativeErrors";
import type { InvestigationNarrativeDataSource } from "../data/investigationNarrativeDataSource";
import {
  joinNarrativeCandidates,
  resolveNarrativeEvidenceReferences,
} from "../lib/investigationNarrative";
import { findingDomId, signalDomId } from "../lib/correlations";
import { tracePositionPresentations } from "../lib/causeCandidates";
import { formatDateTime, humanize } from "../lib/formatters";
import { signalTypeLabels } from "./StructuralSignals";
import { SupportTypeCount } from "./SupportTypes";
import type {
  InvestigationCauseCandidate,
  InvestigationCauseCandidateFacts,
  InvestigationCauseCandidateRank,
  InvestigationFinding,
  InvestigationFindingSeverity,
  InvestigationSignal,
} from "../types/investigation";
import type {
  InvestigationNarrativeSnapshot,
  InvestigationNarrativeTextBlock,
  NarrativeApiError,
} from "../types/investigationNarrative";

export type NarrativeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: InvestigationNarrativeSnapshot }
  | { status: "error"; error: NarrativeApiError };

interface InvestigationNarrativePanelProps {
  alertId: string;
  dataSource: InvestigationNarrativeDataSource;
  candidates: InvestigationCauseCandidate[];
  facts: InvestigationCauseCandidateFacts[];
  ranks: InvestigationCauseCandidateRank[];
  findings: InvestigationFinding[];
  signals: InvestigationSignal[];
  onNavigateFinding: (findingId: string) => void;
  onNavigateSignal: (signalId: string) => void;
}

interface InvestigationNarrativeSnapshotContentProps {
  snapshot: InvestigationNarrativeSnapshot;
  candidates: InvestigationCauseCandidate[];
  facts: InvestigationCauseCandidateFacts[];
  ranks: InvestigationCauseCandidateRank[];
  findings: InvestigationFinding[];
  signals: InvestigationSignal[];
  onNavigateFinding: (findingId: string) => void;
  onNavigateSignal: (signalId: string) => void;
}

const severityStyles: Record<InvestigationFindingSeverity, string> = {
  critical: "border-incident bg-incident text-white",
  high: "border-incident/30 bg-incident/[0.06] text-incident",
  warning: "border-ink/20 bg-canvas text-ink",
  info: "border-steel bg-canvas text-slate",
};

function NarrativeEvidenceReferences({
  block,
  findings,
  signals,
  onNavigateFinding,
  onNavigateSignal,
}: {
  block: InvestigationNarrativeTextBlock;
  findings: InvestigationFinding[];
  signals: InvestigationSignal[];
  onNavigateFinding: (findingId: string) => void;
  onNavigateSignal: (signalId: string) => void;
}) {
  const references = useMemo(
    () => resolveNarrativeEvidenceReferences(block, findings, signals),
    [block, findings, signals],
  );
  const referenceCount = references.findings.length + references.signals.length;

  return (
    <div className="mt-3 rounded-lg border border-steel bg-canvas/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.12em] text-slate">
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Linked evidence
        </p>
        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs font-bold text-slate">
          {referenceCount}
        </span>
        <span className="text-xs leading-5 text-slate">
          Linked to this explanation as a whole, not to individual sentences.
        </span>
      </div>

      {referenceCount === 0 ? (
        <p className="mt-2 text-xs leading-5 text-slate">
          No evidence links were provided for this explanation.
        </p>
      ) : (
        <div className="mt-2.5 grid gap-3 lg:grid-cols-2">
          {references.findings.length > 0 && (
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate">
                Findings
              </p>
              <ol className="mt-1.5 space-y-1.5">
                {references.findings.map(({ id, finding }, index) =>
                  finding ? (
                    <li key={`${id}-${index}`}>
                      <a
                        href={`#${findingDomId(id)}`}
                        onClick={() => onNavigateFinding(id)}
                        className="group flex min-w-0 items-start gap-2 rounded-md border border-steel bg-surface px-2.5 py-2 hover:border-slate/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                      >
                        <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 font-mono text-xs font-extrabold text-ink">
                          F{index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-extrabold uppercase tracking-[0.08em] text-slate">
                            {humanize(finding.type)} · {finding.service ?? "Service not specified"}
                          </span>
                          <span className="mt-0.5 block truncate text-xs font-semibold text-ink" title={finding.message}>
                            {finding.message}
                          </span>
                        </span>
                      </a>
                    </li>
                  ) : (
                    <li key={`${id}-${index}`} className="rounded-md border border-dashed border-steel bg-surface px-2.5 py-2">
                      <p className="text-xs font-bold text-slate">Linked finding not available</p>
                      <p className="mt-1 break-all font-mono text-xs text-slate">{id}</p>
                    </li>
                  ),
                )}
              </ol>
            </div>
          )}

          {references.signals.length > 0 && (
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate">
                Evidence patterns
              </p>
              <ol className="mt-1.5 space-y-1.5">
                {references.signals.map(({ id, signal }, index) =>
                  signal ? (
                    <li key={`${id}-${index}`}>
                      <a
                        href={`#${signalDomId(id)}`}
                        onClick={() => onNavigateSignal(id)}
                        className="group flex min-w-0 items-start gap-2 rounded-md border border-steel bg-surface px-2.5 py-2 hover:border-slate/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                      >
                        <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 font-mono text-xs font-extrabold text-ink">
                          S{index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-extrabold uppercase tracking-[0.08em] text-slate">
                            {signalTypeLabels[signal.type]}
                          </span>
                          <span className="mt-0.5 block truncate text-xs font-semibold text-ink" title={signal.message}>
                            {signal.message}
                          </span>
                        </span>
                      </a>
                    </li>
                  ) : (
                    <li key={`${id}-${index}`} className="rounded-md border border-dashed border-steel bg-surface px-2.5 py-2">
                      <p className="text-xs font-bold text-slate">Linked pattern not available</p>
                      <p className="mt-1 break-all font-mono text-xs text-slate">{id}</p>
                    </li>
                  ),
                )}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function requestInvestigationNarrative(
  dataSource: InvestigationNarrativeDataSource,
  alertId: string,
  signal?: AbortSignal,
) {
  return dataSource.generateNarrative(alertId, { signal });
}

export function InvestigationNarrativeSnapshotContent({
  snapshot,
  candidates,
  facts,
  ranks,
  findings,
  signals,
  onNavigateFinding,
  onNavigateSignal,
}: InvestigationNarrativeSnapshotContentProps) {
  const joinedCandidates = useMemo(
    () =>
      joinNarrativeCandidates(
        ranks,
        candidates,
        facts,
        snapshot.narrative.candidates,
      ),
    [ranks, candidates, facts, snapshot.narrative.candidates],
  );

  return (
    <div className="border-t border-steel px-5 py-4 sm:px-6">
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <div className="flex items-baseline gap-2">
          <dt className="font-extrabold uppercase tracking-[0.1em] text-slate">Evidence through</dt>
          <dd className="font-mono font-semibold text-ink">{formatDateTime(snapshot.evidenceCutoff)}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="font-extrabold uppercase tracking-[0.1em] text-slate">Generated</dt>
          <dd className="font-mono font-semibold text-ink">{formatDateTime(snapshot.generatedAt)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <h3 className="text-sm font-extrabold text-ink">Investigation summary</h3>
        <p className="mt-1.5 max-w-5xl text-sm leading-6 text-ink">
          {snapshot.narrative.summary.text}
        </p>
        <NarrativeEvidenceReferences
          block={snapshot.narrative.summary}
          findings={findings}
          signals={signals}
          onNavigateFinding={onNavigateFinding}
          onNavigateSignal={onNavigateSignal}
        />
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-extrabold text-ink">Candidate explanations</h3>
        {joinedCandidates.length === 0 ? (
          <p className="mt-2 text-sm text-slate">
            No ranked starting points are available to explain.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-steel overflow-hidden rounded-lg border border-steel">
            {joinedCandidates.map(({ rank, facts: candidateFacts, explanation }) => {
              const tracePosition = tracePositionPresentations[rank.tracePosition];
              const support = candidateFacts?.supportDiversity ?? rank.supportDiversity;
              const failures = candidateFacts?.failureFindingCount ?? rank.failureFindingCount;

              return (
                <li key={rank.candidateId} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-extrabold text-slate">Candidate rank #{rank.rank}</span>
                    <p className="break-words font-mono text-sm font-extrabold text-ink [overflow-wrap:anywhere]">
                      {rank.service}
                    </p>
                    {rank.tied && (
                      <span className="inline-flex items-center gap-1 rounded border border-ink/20 bg-canvas px-1.5 py-0.5 text-xs font-extrabold uppercase tracking-[0.1em] text-ink">
                        <Equal className="h-3 w-3" aria-hidden="true" />
                        Tied candidate
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate">
                    {candidateFacts ? (
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-extrabold uppercase tracking-[0.1em] ${severityStyles[candidateFacts.highestSeverity]}`}>
                        {candidateFacts.highestSeverity}
                      </span>
                    ) : (
                      <span>Severity unavailable</span>
                    )}
                    <span className="inline-flex items-center gap-1 font-semibold text-ink">
                      <GitBranch className="h-3.5 w-3.5 text-slate" aria-hidden="true" />
                      {tracePosition.label}
                    </span>
                    <SupportTypeCount count={support} className="font-mono" />
                    <span className="font-mono">{failures} {failures === 1 ? "failure" : "failures"}</span>
                  </div>

                  <p className="mt-2 text-sm leading-6 text-ink">
                    {explanation?.text ?? "No AI explanation was returned for this candidate."}
                  </p>
                  {explanation && (
                    <NarrativeEvidenceReferences
                      block={explanation}
                      findings={findings}
                      signals={signals}
                      onNavigateFinding={onNavigateFinding}
                      onNavigateSignal={onNavigateSignal}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
export function InvestigationNarrativePanel({
  alertId,
  dataSource,
  candidates,
  facts,
  ranks,
  findings,
  signals,
  onNavigateFinding,
  onNavigateSignal,
}: InvestigationNarrativePanelProps) {
  const [state, setState] = useState<NarrativeState>({ status: "idle" });
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    requestController.current?.abort();
    requestController.current = null;
    setState({ status: "idle" });

    return () => {
      requestController.current?.abort();
    };
  }, [alertId]);

  async function generateExplanation() {
    if (requestController.current) return;

    const controller = new AbortController();
    requestController.current = controller;
    setState({ status: "loading" });

    try {
      const data = await requestInvestigationNarrative(
        dataSource,
        alertId,
        controller.signal,
      );

      if (requestController.current !== controller) return;
      setState({ status: "success", data });
    } catch (error: unknown) {
      if (
        requestController.current !== controller ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }

      setState({ status: "error", error: normalizeNarrativeApiError(error) });
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
      }
    }
  }

  const actionLabel =
    state.status === "idle"
      ? "Generate explanation"
      : state.status === "loading"
        ? "Generating explanation…"
        : state.status === "success"
          ? "Refresh explanation"
          : "Retry explanation";

  return (
    <section
      id="ai-explanation"
      tabIndex={-1}
      className="mt-6 scroll-mt-20 overflow-hidden rounded-xl border border-steel bg-surface shadow-panel"
      aria-labelledby="investigation-narrative-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 sm:px-6">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-slate">
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
            Optional help
          </p>
          <h2
            id="investigation-narrative-heading"
            className="mt-1 text-base font-extrabold tracking-tight text-ink"
          >
            AI explanation
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate">
            AI explains the evidence on this page. It does not change the ranking.
          </p>
        </div>
        <button
          type="button"
          onClick={generateExplanation}
          disabled={state.status === "loading"}
          className="rounded-md bg-ink px-3.5 py-2 text-xs font-extrabold text-white hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-wait disabled:bg-slate"
        >
          {actionLabel}
        </button>
      </div>

      {state.status === "loading" && (
        <div
          className="flex items-start gap-3 border-t border-steel px-5 py-4 sm:px-6"
          aria-live="polite"
        >
          <LoaderCircle
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-slate motion-reduce:animate-none"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-extrabold text-ink">
              Generating explanation…
            </p>
            <p className="mt-1 text-xs leading-5 text-slate">
              Preparing an explanation of this investigation's evidence.
            </p>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div
          className="flex items-start gap-3 border-t border-steel px-5 py-4 sm:px-6"
          role="alert"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-slate"
            aria-hidden="true"
          />
          <p className="max-w-3xl text-sm leading-6 text-ink">
            {state.error.message}
          </p>
        </div>
      )}

      {state.status === "success" && (
        <InvestigationNarrativeSnapshotContent
          snapshot={state.data}
          candidates={candidates}
          facts={facts}
          ranks={ranks}
          findings={findings}
          signals={signals}
          onNavigateFinding={onNavigateFinding}
          onNavigateSignal={onNavigateSignal}
        />
      )}
    </section>
  );
}
