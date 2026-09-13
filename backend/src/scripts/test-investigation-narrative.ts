import { createInvestigationNarrativeService } from "../config/investigation-narrative.js";

import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

const context: InvestigationNarrativeContext = {
  alert: {
    id: "smoke-alert",
    title: "Database timeout",
    message: "Cross-service failure evidence observed",
    status: "resolved",
    service: "auth-service",
  },

  window: {
    from: "2026-08-29T00:00:00.000Z",
    to: "2026-08-29T00:05:00.000Z",
  },

  candidates: [
    {
      candidateId: "candidate:postgres",

      service: "postgres",

      rank: 1,
      tied: false,

      highestSeverity: "high",

      tracePosition: "observed_leaf_failure",

      supportDiversity: 4,
      failureFindingCount: 1,

      findingIds: ["finding:postgres"],

      signalIds: ["signal:trace-chain"],

      reasons: [
        "Highest failure severity: high",
        "Observed failing leaf span",
        "Structural support diversity: 4",
        "Failure findings: 1",
      ],
    },

    {
      candidateId: "candidate:auth",

      service: "auth-service",

      rank: 2,
      tied: false,

      highestSeverity: "high",

      tracePosition: "error_ancestor",

      supportDiversity: 6,
      failureFindingCount: 2,

      findingIds: ["finding:auth"],

      signalIds: ["signal:trace-chain"],

      reasons: [
        "Highest failure severity: high",
        "Observed failing ancestor span with error descendant",
        "Structural support diversity: 6",
        "Failure findings: 2",
      ],
    },
  ],

  rankingRationale: {
    candidateOrder: ["candidate:postgres", "candidate:auth"],
    allCandidatesSeverityTied: true,
    commonSeverity: "high",
    comparisons: [
      {
        comparisonId:
          "ranking_comparison:candidate:postgres:candidate:auth",
        firstCandidateId: "candidate:postgres",
        secondCandidateId: "candidate:auth",
        firstService: "postgres",
        secondService: "auth-service",
        outcome: "first_ranks_ahead",
        decisiveDimension: "trace_position",
        dimensionsTiedBeforeDecision: ["failure_severity"],
        deterministicStatement:
          "Both candidates have high failure severity. postgres ranks ahead of auth-service because trace position is the first differing ranking dimension: postgres is an observed failing leaf while auth-service is an error ancestor.",
      },
    ],
  },

  findings: [
    {
      findingId: "finding:postgres",

      type: "trace_error",

      severity: "high",

      timestamp: "2026-08-29T00:00:01.100Z",

      message: "Postgres SELECT operation returned an error",

      service: "postgres",

      traceId: "trace-1",

      spanId: "span-db",
    },

    {
      findingId: "finding:auth",

      type: "trace_error",

      severity: "high",

      timestamp: "2026-08-29T00:00:01.000Z",

      message: "Authentication request returned an error",

      service: "auth-service",

      traceId: "trace-1",

      spanId: "span-auth",
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
