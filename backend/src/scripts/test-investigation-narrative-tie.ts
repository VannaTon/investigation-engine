import { createInvestigationNarrativeService } from "../config/investigation-narrative.js";

import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

const context: InvestigationNarrativeContext = {
  alert: {
    id: "tie-alert",
    title: "Parallel dependency failures",
    message: "Failure evidence was observed on multiple downstream services",
    status: "resolved",
    service: "gateway",
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
      tied: true,

      highestSeverity: "high",

      tracePosition: "observed_leaf_failure",

      supportDiversity: 3,
      failureFindingCount: 1,

      findingIds: ["finding:postgres"],

      signalIds: ["signal:cross-service"],

      reasons: [
        "Highest failure severity: high",
        "Observed failing leaf span",
        "Structural support diversity: 3",
        "Failure findings: 1",
      ],
    },

    {
      candidateId: "candidate:redis",
      service: "redis",

      rank: 1,
      tied: true,

      highestSeverity: "high",

      tracePosition: "observed_leaf_failure",

      supportDiversity: 3,
      failureFindingCount: 1,

      findingIds: ["finding:redis"],

      signalIds: ["signal:cross-service"],

      reasons: [
        "Highest failure severity: high",
        "Observed failing leaf span",
        "Structural support diversity: 3",
        "Failure findings: 1",
      ],
    },
  ],

  rankingRationale: {
    candidateOrder: ["candidate:postgres", "candidate:redis"],
    allCandidatesSeverityTied: true,
    commonSeverity: "high",
    comparisons: [
      {
        comparisonId:
          "ranking_comparison:candidate:postgres:candidate:redis",
        firstCandidateId: "candidate:postgres",
        secondCandidateId: "candidate:redis",
        firstService: "postgres",
        secondService: "redis",
        outcome: "tie",
        decisiveDimension: "tie",
        dimensionsTiedBeforeDecision: [
          "failure_severity",
          "trace_position",
          "support_diversity",
          "failure_finding_count",
        ],
        deterministicStatement:
          "postgres and redis are co-equal cause candidates at rank 1; failure severity (high), trace position (an observed failing leaf), structural support diversity (3), and failure finding count (1) are tied.",
      },
    ],
  },

  findings: [
    {
      findingId: "finding:postgres",

      type: "trace_error",

      severity: "high",

      timestamp: "2026-08-29T00:00:01.000Z",

      message: "Postgres operation returned an error",

      service: "postgres",

      traceId: "trace-postgres",

      spanId: "span-postgres",
    },

    {
      findingId: "finding:redis",

      type: "trace_error",

      severity: "high",

      timestamp: "2026-08-29T00:00:01.100Z",

      message: "Redis operation returned an error",

      service: "redis",

      traceId: "trace-redis",

      spanId: "span-redis",
    },
  ],

  signalTypes: ["cross_service_failure"],

  metricTimings: [],
};

const narrativeService = createInvestigationNarrativeService();

const narrative = await narrativeService.generate(context);

console.dir(narrative, {
  depth: null,
});
