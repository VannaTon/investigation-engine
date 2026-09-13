import type { InvestigationResponseV1 } from "../types/investigation-response.js";

import type {
  InvestigationNarrativeContext,
  InvestigationNarrativeFinding,
  InvestigationNarrativeMetricTiming,
} from "../types/investigation-narrative-context.js";

import { createInvestigationRankingRationale } from "./investigation-ranking-rationale.service.js";

export function buildNarrativeContext(
  investigation: InvestigationResponseV1,
): InvestigationNarrativeContext {
  const candidateById = new Map(
    investigation.causeCandidates.map((candidate) => [candidate.id, candidate]),
  );

  const factsByCandidateId = new Map(
    investigation.causeCandidateFacts.map((facts) => [
      facts.candidateId,
      facts,
    ]),
  );

  // Important:
  // Preserve backend ranking order.
  // Do NOT re-rank candidates here.
  const candidates = investigation.causeCandidateRanks.map((rank) => {
    const candidate = candidateById.get(rank.candidateId);

    const facts = factsByCandidateId.get(rank.candidateId);

    if (!candidate) {
      throw new Error(`Missing cause candidate for ${rank.candidateId}`);
    }

    if (!facts) {
      throw new Error(`Missing cause candidate facts for ${rank.candidateId}`);
    }

    return {
      candidateId: rank.candidateId,

      service: rank.service,

      rank: rank.rank,

      tied: rank.tied,

      highestSeverity: facts.highestSeverity,

      tracePosition: rank.tracePosition,

      supportDiversity: rank.supportDiversity,

      failureFindingCount: rank.failureFindingCount,

      findingIds: [...candidate.findingIds],

      signalIds: [...candidate.signalIds],

      reasons: [...rank.reasons],
    };
  });

  const candidateFindingIds = new Set(
    candidates.flatMap((candidate) => candidate.findingIds),
  );

  const rankingRationale = createInvestigationRankingRationale(
    investigation.causeCandidateRanks,
    investigation.causeCandidateFacts,
  );

  const candidateServices = new Set(
    candidates.map((candidate) => candidate.service),
  );

  /*
   * Include:
   * 1. Failure findings referenced directly by candidates.
   * 2. Metric-threshold findings on candidate services.
   *
   * Metrics remain contextual evidence.
   * They do NOT participate in candidate ranking.
   */
  const relevantFindings = investigation.findings.filter(
    (finding) =>
      candidateFindingIds.has(finding.id) ||
      (finding.type === "metric_threshold" &&
        finding.service !== undefined &&
        candidateServices.has(finding.service)),
  );

  const findings: InvestigationNarrativeFinding[] = relevantFindings
    .map((finding) => ({
      findingId: finding.id,

      type: finding.type,

      severity: finding.severity,

      timestamp: finding.timestamp,

      message: finding.message,

      ...(finding.service !== undefined
        ? {
            service: finding.service,
          }
        : {}),

      ...(finding.traceId !== undefined
        ? {
            traceId: finding.traceId,
          }
        : {}),

      ...(finding.spanId !== undefined
        ? {
            spanId: finding.spanId,
          }
        : {}),
    }))
    .sort(
      (a, b) =>
        toTimestampMs(a.timestamp) - toTimestampMs(b.timestamp) ||
        a.findingId.localeCompare(b.findingId),
    );

  const referencedSignalIds = new Set(
    candidates.flatMap((candidate) => candidate.signalIds),
  );

  const signalTypes = [
    ...new Set(
      investigation.signals
        .filter((signal) => referencedSignalIds.has(signal.id))
        .map((signal) => signal.type),
    ),
  ].sort();

  const metricTimings = createMetricTimings(investigation, candidateServices);

  return {
    alert: {
      id: investigation.alert.id,

      title: investigation.alert.title,

      message: investigation.alert.message,

      status: investigation.alert.status,

      ...(investigation.alert.service !== undefined
        ? {
            service: investigation.alert.service,
          }
        : {}),
    },

    window: {
      from: investigation.window.from,

      to: investigation.window.to,
    },

    candidates,
    rankingRationale,
    findings,
    signalTypes,
    metricTimings,
  };
}

function createMetricTimings(
  investigation: InvestigationResponseV1,
  candidateServices: Set<string>,
): InvestigationNarrativeMetricTiming[] {
  const metricFindings = investigation.findings.filter(
    (finding) =>
      finding.type === "metric_threshold" &&
      finding.service !== undefined &&
      candidateServices.has(finding.service),
  );

  const result: InvestigationNarrativeMetricTiming[] = [];

  for (const metricFinding of metricFindings) {
    const service = metricFinding.service;

    if (service === undefined) {
      continue;
    }

    const traceErrors = investigation.findings
      .filter(
        (finding) =>
          finding.type === "trace_error" && finding.service === service,
      )
      .sort((a, b) => toTimestampMs(a.timestamp) - toTimestampMs(b.timestamp));

    const earliestTraceError = traceErrors[0];

    if (!earliestTraceError) {
      continue;
    }

    const matchingMetrics = investigation.metrics.filter(
      (metric) =>
        metric.service === service &&
        metric.timestamp === metricFinding.timestamp,
    );

    const metric =
      matchingMetrics.length === 1
        ? matchingMetrics[0]
        : matchingMetrics.find((candidate) =>
            metricFinding.message.startsWith(`${candidate.name} `),
          );

    if (!metric) {
      continue;
    }

    const deltaMs =
      toTimestampMs(metricFinding.timestamp) -
      toTimestampMs(earliestTraceError.timestamp);

    result.push({
      service,

      findingId: metricFinding.id,

      metricName: metric.name,

      /*
       * Context only.
       * NOT used by Cause Candidate Ranking v1.
       *
       * Negative = metric observation before
       * earliest trace failure.
       *
       * Positive = metric observation after
       * earliest trace failure.
       */
      observedMetricAnomalyDeltaMs: deltaMs,
    });
  }

  return result.sort(
    (a, b) =>
      a.service.localeCompare(b.service) ||
      a.findingId.localeCompare(b.findingId),
  );
}

function toTimestampMs(timestamp: string): number {
  /*
   * ClickHouse DateTime64 values in the API
   * currently look like:
   *
   * 2026-08-15 06:10:12.778Z
   *
   * Normalize the space to ISO "T".
   */
  const normalized = timestamp.includes("T")
    ? timestamp
    : timestamp.replace(" ", "T");

  const value = Date.parse(normalized);

  if (Number.isNaN(value)) {
    throw new Error(`Invalid investigation timestamp: ${timestamp}`);
  }

  return value;
}
