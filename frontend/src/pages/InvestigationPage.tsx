import { useCallback, useEffect, useRef, useState } from "react";
import { AlertLifecycleActions } from "../components/AlertLifecycleActions";
import type { AlertLifecycleDataSource } from "../data/alertLifecycleDataSource";
import { ArrowLeft, RefreshCw, SearchX } from "lucide-react";
import { CauseCandidateRanking } from "../components/CauseCandidateRanking";
import { Evidence } from "../components/Evidence";
import { EvidenceGroups } from "../components/EvidenceGroups";
import { EvidenceStory } from "../components/EvidenceStory";
import { FindingsTimeline } from "../components/FindingsTimeline";
import { IntegrityIssues } from "../components/IntegrityIssues";
import { InvestigationOverview } from "../components/InvestigationOverview";
import { InvestigationNarrativePanel } from "../components/InvestigationNarrativePanel";
import { RelatedEvidence } from "../components/RelatedEvidence";
import { StructuralSignals } from "../components/StructuralSignals";
import { TraceTree } from "../components/TraceTree";
import {
  InvestigationHttpError,
  InvestigationNetworkError,
  InvestigationNotFoundError,
  InvalidInvestigationResponseError,
} from "../data/investigationErrors";
import type { InvestigationDataSource } from "../data/investigationDataSource";
import type { InvestigationNarrativeDataSource } from "../data/investigationNarrativeDataSource";
import { findingDomId } from "../lib/correlations";
import type { ExactSpanReference } from "../lib/exactSpanLogs";
import {
  investigationReviewHref,
  resolveInvestigationReviewLocation,
  type InvestigationReviewLocationTarget,
} from "../lib/investigationReviewLocation";
import { logDomId } from "../lib/investigationTargets";
import type { AlertInvestigationResponse } from "../types/investigation";

type LoadFailureKind = "network" | "invalid-response" | "http" | "unexpected";

type PageState =
  | { status: "loading" }
  | { status: "ready"; investigation: AlertInvestigationResponse }
  | { status: "not-found"; alertId: string | null }
  | {
      status: "error";
      kind: LoadFailureKind;
      statusCode?: number;
    };

type DetailSectionId =
  | "findings"
  | "timeline"
  | "structural-signals"
  | "evidence-groups"
  | "relationships"
  | "telemetry"
  | "integrity";

interface InvestigationPageProps {
  alertId: string | null;
  returnHref?: string;
  dataSource: InvestigationDataSource;
  narrativeDataSource: InvestigationNarrativeDataSource;
  lifecycleDataSource?: AlertLifecycleDataSource | undefined;
  onOpenDefault?: () => void;
}

function BackToInvestigations({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="mb-4 inline-flex items-center gap-2 rounded-md text-sm font-bold text-slate underline decoration-steel underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to investigations
    </a>
  );
}

export function requestInvestigation(
  dataSource: InvestigationDataSource,
  alertId: string,
  signal?: AbortSignal,
) {
  return dataSource.getInvestigation(alertId, { signal });
}

function failureCopy(state: Extract<PageState, { status: "error" }>) {
  switch (state.kind) {
    case "network":
      return {
        heading: "Could not load this investigation.",
        detail: "We could not connect to the server. Check your connection and try again.",
      };
    case "invalid-response":
      return {
        heading: "Could not read this investigation.",
        detail: "The server sent investigation data we could not use. Try again.",
      };
    case "http":
      return {
        heading: "Could not load this investigation.",
        detail: state.statusCode
          ? `The server could not load the investigation (error ${state.statusCode}). Try again.`
          : "The server could not load the investigation. Try again.",
      };
    case "unexpected":
      return {
        heading: "Investigation unavailable.",
        detail: "The investigation could not be loaded.",
      };
  }
}

export function InvestigationPage({
  alertId,
  returnHref = "/investigations",
  dataSource,
  narrativeDataSource,
  lifecycleDataSource,
  onOpenDefault,
}: InvestigationPageProps) {
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);
  const [selectedCorrelationId, setSelectedCorrelationId] = useState<string | null>(
    null,
  );
  const [selectedEvidenceGroupId, setSelectedEvidenceGroupId] = useState<
    string | null
  >(null);
  const [selectedRankFindingId, setSelectedRankFindingId] = useState<
    string | null
  >(null);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedExactSpan, setSelectedExactSpan] = useState<ExactSpanReference | null>(null);
  const [openDetailSection, setOpenDetailSection] = useState<DetailSectionId | null>(null);
  const appliedReviewTargetRef = useRef<InvestigationReviewLocationTarget | null>(null);

  const applyReviewLocationTarget = useCallback((
    target: InvestigationReviewLocationTarget | null,
    closePreviousDrawer = true,
  ) => {
    const previousTarget = appliedReviewTargetRef.current;
    appliedReviewTargetRef.current = target;

    if (target?.kind === "finding") {
      setSelectedRankFindingId(target.findingId);
      setSelectedExactSpan(null);
      setSelectedCandidateId(null);
      setSelectedSignalId(null);
      setSelectedEvidenceGroupId(null);
      setSelectedCorrelationId(null);
      setOpenDetailSection("findings");
      return;
    }

    if (target?.kind === "log") {
      setSelectedRankFindingId(null);
      setSelectedExactSpan(target.exactSpanReference ?? null);
      setSelectedCandidateId(null);
      setSelectedSignalId(null);
      setSelectedEvidenceGroupId(null);
      setSelectedCorrelationId(null);
      setOpenDetailSection("telemetry");
      return;
    }

    setSelectedRankFindingId(null);
    setSelectedExactSpan(null);
    if (closePreviousDrawer && previousTarget) {
      setOpenDetailSection((current) => {
        if (previousTarget.kind === "finding" && current === "findings") {
          return null;
        }
        if (previousTarget.kind === "log" && current === "telemetry") {
          return null;
        }
        return current;
      });
    }
  }, []);

  const writeReviewLocation = useCallback((
    targetId: string | null,
    mode: "push" | "replace",
  ) => {
    if (typeof window === "undefined") return;

    const nextHref = investigationReviewHref(
      window.location.pathname,
      window.location.search,
      targetId,
    );
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextHref === currentHref) return;

    if (mode === "replace") {
      window.history.replaceState(window.history.state, "", nextHref);
    } else {
      window.history.pushState(window.history.state, "", nextHref);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    if (!alertId) {
      setState({ status: "not-found", alertId: null });
      document.title = "Investigation not found · Observability Platform";
      return () => {
        active = false;
        controller.abort();
      };
    }

    setState({ status: "loading" });
    setSelectedCorrelationId(null);
    setSelectedEvidenceGroupId(null);
    setSelectedRankFindingId(null);
    setSelectedSignalId(null);
    setSelectedCandidateId(null);
    setSelectedExactSpan(null);
    setOpenDetailSection(null);
    appliedReviewTargetRef.current = null;

    requestInvestigation(dataSource, alertId, controller.signal)
      .then((investigation) => {
        if (!active) return;
        setState({ status: "ready", investigation });
        document.title = `${investigation.alert.title} · Investigation`;
      })
      .catch((error: unknown) => {
        if (!active) return;

        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (error instanceof InvestigationNotFoundError) {
          setState({ status: "not-found", alertId: error.alertId });
          document.title = "Investigation not found · Observability Platform";
          return;
        }

        if (error instanceof InvestigationNetworkError) {
          setState({ status: "error", kind: "network" });
        } else if (error instanceof InvalidInvestigationResponseError) {
          setState({ status: "error", kind: "invalid-response" });
        } else if (error instanceof InvestigationHttpError) {
          setState({
            status: "error",
            kind: "http",
            statusCode: error.status,
          });
        } else {
          setState({ status: "error", kind: "unexpected" });
        }

        document.title = "Investigation unavailable · Observability Platform";
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [alertId, dataSource, requestVersion]);

  const readyInvestigation = state.status === "ready" ? state.investigation : null;
  useEffect(() => {
    if (!readyInvestigation || typeof window === "undefined") return;

    const restoreReviewLocation = () => {
      applyReviewLocationTarget(
        resolveInvestigationReviewLocation(window.location.hash, {
          findings: readyInvestigation.findings,
          logs: readyInvestigation.logs,
        }),
      );
    };

    restoreReviewLocation();
    window.addEventListener("hashchange", restoreReviewLocation);
    window.addEventListener("popstate", restoreReviewLocation);
    return () => {
      window.removeEventListener("hashchange", restoreReviewLocation);
      window.removeEventListener("popstate", restoreReviewLocation);
    };
  }, [applyReviewLocationTarget, readyInvestigation]);

  if (state.status === "loading") {
    return (
      <><BackToInvestigations href={returnHref} /><section
        className="rounded-xl border border-steel bg-surface p-6 shadow-panel"
        aria-busy="true"
        aria-live="polite"
      >
        <p className="text-sm font-semibold text-slate">Loading investigation…</p>
      </section></>
    );
  }

  if (state.status === "not-found") {
    return (
      <><BackToInvestigations href={returnHref} /><section className="rounded-xl border border-steel bg-surface p-6 shadow-panel">
        <SearchX className="h-7 w-7 text-slate" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-extrabold tracking-tight text-ink">
          Investigation not found.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate">
          {state.alertId
            ? "No investigation matches this alert ID."
            : "Choose an investigation from the list."}
        </p>
        {state.alertId && (
          <p className="mt-2 break-all font-mono text-xs text-slate">{state.alertId}</p>
        )}
        {onOpenDefault && (
          <button
            type="button"
            onClick={onOpenDefault}
            className="mt-5 rounded-md bg-ink px-3.5 py-2 text-sm font-bold text-white hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Open resolved example
          </button>
        )}
      </section></>
    );
  }

  if (state.status === "error") {
    const copy = failureCopy(state);

    return (
      <><BackToInvestigations href={returnHref} /><section
        className="rounded-xl border border-steel bg-surface p-6 shadow-panel"
        role="alert"
      >
        <h1 className="text-lg font-extrabold text-ink">{copy.heading}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate">{copy.detail}</p>
        <button
          type="button"
          onClick={() => setRequestVersion((version) => version + 1)}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-ink px-3.5 py-2 text-sm font-bold text-white hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      </section></>
    );
  }

  const { investigation } = state;
  const selectedCorrelation = investigation.correlations?.find(
    (correlation) => correlation.id === selectedCorrelationId,
  );
  const selectedEvidenceGroup = investigation.evidenceGroups?.find(
    (group) => group.id === selectedEvidenceGroupId,
  );
  const selectedSignal = investigation.signals.find(
    (signal) => signal.id === selectedSignalId,
  );
  const selectedCandidate = investigation.causeCandidates.find(
    (candidate) => candidate.id === selectedCandidateId,
  );
  const highlightedFindingIds = selectedCandidate
    ? new Set(selectedCandidate.findingIds)
    : selectedRankFindingId
      ? new Set([selectedRankFindingId])
      : selectedSignal
        ? new Set(selectedSignal.findingIds)
        : selectedEvidenceGroup
          ? new Set(selectedEvidenceGroup.findingIds)
          : selectedCorrelation
            ? new Set(selectedCorrelation.findingIds)
            : undefined;
  const highlightedFindingLabel = selectedCandidate
    ? "Candidate finding"
    : selectedRankFindingId
      ? "Selected finding"
      : highlightedFindingIds
        ? "Connected finding"
        : undefined;

  function openFindingReview(findingId: string) {
    applyReviewLocationTarget(
      {
        kind: "finding",
        targetId: findingDomId(findingId),
        findingId,
      },
      false,
    );
  }

  function openExactSpanReview(reference: ExactSpanReference) {
    const logIndex = investigation.logs.findIndex(
      (log) =>
        log.traceId === reference.traceId && log.spanId === reference.spanId,
    );

    if (logIndex >= 0) {
      const log = investigation.logs[logIndex];
      applyReviewLocationTarget(
        {
          kind: "log",
          targetId: logDomId(log.timestamp, log.service, logIndex),
          logIndex,
          exactSpanReference: reference,
        },
        false,
      );
      return;
    }

    appliedReviewTargetRef.current = null;
    setSelectedRankFindingId(null);
    setSelectedExactSpan(reference);
    setSelectedCandidateId(null);
    setSelectedSignalId(null);
    setSelectedEvidenceGroupId(null);
    setSelectedCorrelationId(null);
    setOpenDetailSection("telemetry");
  }

  function clearManagedReviewLocation(closePreviousDrawer = false) {
    if (typeof window !== "undefined") {
      const currentTarget = resolveInvestigationReviewLocation(
        window.location.hash,
        {
          findings: investigation.findings,
          logs: investigation.logs,
        },
      );
      if (currentTarget) writeReviewLocation(null, "replace");
    }
    applyReviewLocationTarget(null, closePreviousDrawer);
  }

  return (
    <>
      <BackToInvestigations href={returnHref} />
      <InvestigationOverview investigation={investigation}>
        <CauseCandidateRanking
          key={`candidates-${investigation.alert.id}`}
          candidates={investigation.causeCandidates}
          facts={investigation.causeCandidateFacts}
          ranks={investigation.causeCandidateRanks}
          findings={investigation.findings}
          correlations={investigation.correlations}
          signals={investigation.signals}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={(candidateId) => {
            setSelectedCandidateId(candidateId);
            if (candidateId) {
              clearManagedReviewLocation();
              setSelectedSignalId(null);
              setSelectedEvidenceGroupId(null);
              setSelectedCorrelationId(null);
            }
          }}
          onOpenFinding={() => setOpenDetailSection("findings")}
        />
      </InvestigationOverview>
      {lifecycleDataSource && investigation.alert.id === alertId && <AlertLifecycleActions
        key={investigation.alert.id}
        alert={investigation.alert}
        dataSource={lifecycleDataSource}
        investigationSource={dataSource}
        onUpdated={(next) => setState({ status: "ready", investigation: next })}
      />}
      <InvestigationNarrativePanel
        alertId={investigation.alert.id}
        dataSource={narrativeDataSource}
        candidates={investigation.causeCandidates}
        facts={investigation.causeCandidateFacts}
        ranks={investigation.causeCandidateRanks}
        findings={investigation.findings}
        signals={investigation.signals}
        onNavigateFinding={(findingId) => {
          openFindingReview(findingId);
        }}
        onNavigateSignal={(signalId) => {
          setSelectedSignalId(signalId);
          setSelectedCandidateId(null);
          clearManagedReviewLocation();
          setSelectedEvidenceGroupId(null);
          setSelectedCorrelationId(null);
          setOpenDetailSection("structural-signals");
        }}
      />
      <EvidenceStory
        ranks={investigation.evidenceRanks}
        findings={investigation.findings}
        evidenceGroups={investigation.evidenceGroups}
        correlations={investigation.correlations}
        signals={investigation.signals}
        selectedFindingId={selectedRankFindingId}
        selectedGroupId={selectedEvidenceGroupId}
        onReviewFinding={(findingId) => {
          openFindingReview(findingId);
        }}
        onReviewGroup={(groupId) => {
          setSelectedEvidenceGroupId(groupId);
          setSelectedCandidateId(null);
          clearManagedReviewLocation();
          setSelectedSignalId(null);
          setSelectedCorrelationId(null);
          setOpenDetailSection("findings");
        }}
      />
      <TraceTree
        traces={investigation.traces}
        logs={investigation.logs}
        selectedExactSpan={selectedExactSpan}
        onReviewExactSpanLogs={(reference) => {
          openExactSpanReview(reference);
        }}
      />
      <section
        className="mt-6 overflow-hidden rounded-xl border border-steel bg-surface shadow-panel"
        aria-labelledby="details-on-demand-heading"
      >
        <div className="border-b border-steel px-5 py-4 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.17em] text-slate">
            Details on demand
          </p>
          <h2
            id="details-on-demand-heading"
            className="mt-1 text-base font-extrabold tracking-tight text-ink"
          >
            Investigation details
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate">
            Open a focused detail view without losing the primary investigation context.
          </p>
        </div>

        <FindingsTimeline
          key={`details-${investigation.alert.id}`}
          findings={investigation.findings}
          timeline={investigation.timeline}
          priorityFindingIds={investigation.evidenceRanks.map((rank) => rank.findingId)}
          evidenceRanks={investigation.evidenceRanks}
          evidenceGroups={investigation.evidenceGroups}
          correlations={investigation.correlations}
          signals={investigation.signals}
          logs={investigation.logs}
          traces={investigation.traces}
          highlightedFindingIds={highlightedFindingIds}
          highlightedFindingLabel={highlightedFindingLabel}
          reviewedFindingId={selectedRankFindingId}
          onReviewFinding={(findingId) => {
            if (findingId) {
              openFindingReview(findingId);
              writeReviewLocation(findingDomId(findingId), "push");
            } else {
              clearManagedReviewLocation();
            }
          }}
          onOpenExactSpanLogs={(reference) => {
            openExactSpanReview(reference);
          }}
          grouped
          openSection={
            openDetailSection === "findings" || openDetailSection === "timeline"
              ? openDetailSection
              : null
          }
          onOpenSection={(section) => {
            if (section === null && openDetailSection === "findings") {
              clearManagedReviewLocation();
            }
            setOpenDetailSection(section);
          }}
        />
        <StructuralSignals
          key={`signals-${investigation.alert.id}`}
          signals={investigation.signals}
          findings={investigation.findings}
          selectedSignalId={selectedSignalId}
          grouped
          detailsOpen={openDetailSection === "structural-signals"}
          onDetailsOpenChange={(open) =>
            setOpenDetailSection(open ? "structural-signals" : null)
          }
          onNavigateFinding={(findingId) => {
            openFindingReview(findingId);
          }}
          onSelectSignal={(signalId) => {
            setSelectedSignalId(signalId);
            if (signalId) {
              setSelectedCandidateId(null);
              clearManagedReviewLocation();
              setSelectedEvidenceGroupId(null);
              setSelectedCorrelationId(null);
              setOpenDetailSection("findings");
            }
          }}
        />
        <EvidenceGroups
          key={`groups-${investigation.alert.id}`}
          evidenceGroups={investigation.evidenceGroups}
          correlations={investigation.correlations}
          findings={investigation.findings}
          selectedGroupId={selectedEvidenceGroupId}
          grouped
          detailsOpen={openDetailSection === "evidence-groups"}
          onDetailsOpenChange={(open) =>
            setOpenDetailSection(open ? "evidence-groups" : null)
          }
          onNavigateFinding={(findingId) => {
            openFindingReview(findingId);
          }}
          onSelectGroup={(groupId) => {
            setSelectedEvidenceGroupId(groupId);
            if (groupId) {
              setSelectedCandidateId(null);
              clearManagedReviewLocation();
              setSelectedSignalId(null);
              setSelectedCorrelationId(null);
              setOpenDetailSection("findings");
            }
          }}
        />
        <RelatedEvidence
          key={`relationships-${investigation.alert.id}`}
          correlations={investigation.correlations}
          findings={investigation.findings}
          selectedCorrelationId={selectedCorrelationId}
          grouped
          detailsOpen={openDetailSection === "relationships"}
          onDetailsOpenChange={(open) =>
            setOpenDetailSection(open ? "relationships" : null)
          }
          onNavigateFinding={(findingId) => {
            openFindingReview(findingId);
          }}
          onSelectCorrelation={(correlationId) => {
            setSelectedCorrelationId(correlationId);
            if (correlationId) {
              setSelectedCandidateId(null);
              clearManagedReviewLocation();
              setSelectedSignalId(null);
              setSelectedEvidenceGroupId(null);
              setOpenDetailSection("findings");
            }
          }}
        />
        <Evidence
          key={`telemetry-${investigation.alert.id}`}
          metrics={investigation.metrics}
          logs={investigation.logs}
          grouped
          detailsOpen={openDetailSection === "telemetry"}
          focusedExactSpan={selectedExactSpan}
          onDetailsOpenChange={(open) => {
            if (!open && openDetailSection === "telemetry") {
              clearManagedReviewLocation();
            }
            setOpenDetailSection(open ? "telemetry" : null);
          }}
        />
        <IntegrityIssues
          key={`integrity-${investigation.alert.id}`}
          issues={investigation.integrityIssues}
          logs={investigation.logs}
          traces={investigation.traces}
          grouped
          detailsOpen={openDetailSection === "integrity"}
          onDetailsOpenChange={(open) =>
            setOpenDetailSection(open ? "integrity" : null)
          }
          onOpenTelemetry={() => setOpenDetailSection("telemetry")}
          onOpenTrace={() => setOpenDetailSection(null)}
        />
      </section>

    </>
  );
}





