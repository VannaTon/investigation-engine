import { createInvestigationNarrativeService } from "../config/investigation-narrative.js";

import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

const context: InvestigationNarrativeContext = {
  alert: {
    id: "severity-alert",
    title: "Critical authentication failure",
    message: "Critical failure evidence was observed across the request path",
    status: "resolved",
    service: "auth-service",
  },

  window: {
    from: "2026-08-29T00:00:00.000Z",
    to: "2026-08-29T00:05:00.000Z",
  },

  candidates: [
    {
      candidateId: "candidate:auth",
      service: "auth-service",

      rank: 1,
      tied: false,

      highestSeverity: "critical",
      tracePosition: "error_ancestor",

      supportDiversity: 3,
      failureFindingCount: 1,

      findingIds: ["finding:auth"],

      signalIds: ["signal:trace-chain"],

      reasons: [
        "Highest failure severity: critical",
        "Observed failing ancestor span with error descendant",
        "Structural support diversity: 3",
        "Failure findings: 1",
      ],
    },

    {
      candidateId: "candidate:postgres",
      service: "postgres",

      rank: 2,
      tied: false,

      highestSeverity: "high",
      tracePosition: "observed_leaf_failure",

      supportDiversity: 5,
      failureFindingCount: 2,

      findingIds: ["finding:postgres"],

      signalIds: ["signal:trace-chain"],

      reasons: [
        "Highest failure severity: high",
        "Observed failing leaf span",
        "Structural support diversity: 5",
        "Failure findings: 2",
      ],
    },
  ],

  rankingRationale: {
    candidateOrder: ["candidate:auth", "candidate:postgres"],
    allCandidatesSeverityTied: false,
    comparisons: [
      {
        comparisonId:
          "ranking_comparison:candidate:auth:candidate:postgres",
        firstCandidateId: "candidate:auth",
        secondCandidateId: "candidate:postgres",
        firstService: "auth-service",
        secondService: "postgres",
        outcome: "first_ranks_ahead",
        decisiveDimension: "failure_severity",
        dimensionsTiedBeforeDecision: [],
        deterministicStatement:
          "auth-service ranks ahead of postgres because failure severity is the first differing ranking dimension: auth-service has critical failure severity while postgres has high failure severity.",
      },
    ],
  },

  findings: [
    {
      findingId: "finding:auth",
      type: "trace_error",
      severity: "critical",
      timestamp: "2026-08-29T00:00:01.000Z",
      message: "Critical authentication operation failure",
      service: "auth-service",
      traceId: "trace-1",
      spanId: "span-auth",
    },

    {
      findingId: "finding:postgres",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-29T00:00:01.100Z",
      message: "Postgres operation returned an error",
      service: "postgres",
      traceId: "trace-1",
      spanId: "span-db",
    },
  ],

  signalTypes: ["trace_failure_chain"],

  metricTimings: [],
};

const narrativeService = createInvestigationNarrativeService();

const narrative = await narrativeService.generate(context);

console.dir(narrative, {
  depth: null,
});
