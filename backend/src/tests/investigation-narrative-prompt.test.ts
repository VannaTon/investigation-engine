import assert from "node:assert/strict";

import { buildInvestigationNarrativePrompt } from "../services/investigation-narrative-prompt.service.js";

import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

// --------------------------------------------------
// Case 1:
// Real postgres > auth > user scenario.
// --------------------------------------------------

const realContext: InvestigationNarrativeContext = {
  alert: {
    id: "alert-1",
    title: "High CPU",
    message: "cpu_usage exceeded threshold 90",
    status: "resolved",
    service: "auth-service",
  },

  window: {
    from: "2026-08-15T05:50:00.000Z",
    to: "2026-08-15T06:30:00.000Z",
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
      findingIds: ["finding:postgres-trace"],
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
      findingIds: ["finding:auth-log", "finding:auth-trace"],
      signalIds: ["signal:trace-chain"],
      reasons: [
        "Highest failure severity: high",
        "Observed failing ancestor span with error descendant",
        "Structural support diversity: 6",
        "Failure findings: 2",
      ],
    },

    {
      candidateId: "candidate:user",
      service: "user-service",
      rank: 3,
      tied: false,
      highestSeverity: "high",
      tracePosition: "error_ancestor",
      supportDiversity: 4,
      failureFindingCount: 1,
      findingIds: ["finding:user-trace"],
      signalIds: ["signal:trace-chain"],
      reasons: [
        "Highest failure severity: high",
        "Observed failing ancestor span with error descendant",
        "Structural support diversity: 4",
        "Failure findings: 1",
      ],
    },
  ],

  rankingRationale: {
    candidateOrder: [
      "candidate:postgres",
      "candidate:auth",
      "candidate:user",
    ],
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
      {
        comparisonId:
          "ranking_comparison:candidate:auth:candidate:user",
        firstCandidateId: "candidate:auth",
        secondCandidateId: "candidate:user",
        firstService: "auth-service",
        secondService: "user-service",
        outcome: "first_ranks_ahead",
        decisiveDimension: "support_diversity",
        dimensionsTiedBeforeDecision: [
          "failure_severity",
          "trace_position",
        ],
        deterministicStatement:
          "Both candidates tie on failure severity (high) and trace position (an error ancestor). auth-service ranks ahead of user-service because structural support diversity is the first differing ranking dimension: 6 versus 4.",
      },
    ],
  },

  findings: [
    {
      findingId: "finding:auth-trace",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-15 06:10:00.000Z",
      message: "Trace error in auth-service",
      service: "auth-service",
    },

    {
      findingId: "finding:auth-log",
      type: "log_error",
      severity: "high",
      timestamp: "2026-08-15 06:10:00.200Z",
      message: "database timeout",
      service: "auth-service",
    },

    {
      findingId: "finding:user-trace",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-15 06:10:00.050Z",
      message: "Trace error in user-service",
      service: "user-service",
    },

    {
      findingId: "finding:postgres-trace",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-15 06:10:00.100Z",
      message: "Trace error in postgres",
      service: "postgres",
    },

    {
      findingId: "finding:cpu",
      type: "metric_threshold",
      severity: "warning",
      timestamp: "2026-08-15 06:10:12.778Z",
      message: "cpu_usage reached 95",
      service: "auth-service",
    },
  ],

  signalTypes: [
    "cross_service_failure",
    "multi_signal_evidence",
    "trace_failure_chain",
  ],

  metricTimings: [
    {
      service: "auth-service",
      findingId: "finding:cpu",
      metricName: "cpu_usage",
      observedMetricAnomalyDeltaMs: 12_778,
    },
  ],
};

{
  const prompt = buildInvestigationNarrativePrompt(realContext);

  assert.ok(prompt.system.includes("Never change candidate ranks"));

  assert.ok(prompt.system.includes("does NOT mean confirmed root cause"));

  assert.ok(
    prompt.system.includes(
      "rankingRationale is the authoritative explanation",
    ),
  );

  const payload = JSON.parse(prompt.user);

  const context = payload.context as InvestigationNarrativeContext;

  assert.deepEqual(
    context.candidates.map((candidate) => candidate.service),
    ["postgres", "auth-service", "user-service"],
  );

  assert.deepEqual(
    context.candidates.map((candidate) => candidate.rank),
    [1, 2, 3],
  );

  assert.equal(context.candidates[0]?.tracePosition, "observed_leaf_failure");

  assert.equal(context.candidates[0]?.supportDiversity, 4);

  assert.equal(context.candidates[1]?.supportDiversity, 6);

  assert.equal(context.metricTimings[0]?.observedMetricAnomalyDeltaMs, 12_778);

  assert.deepEqual(
    context.rankingRationale.comparisons.map(
      (comparison) => comparison.decisiveDimension,
    ),
    ["trace_position", "support_diversity"],
  );

  assert.ok(payload.requiredOutputShape);

  assert.ok(payload.requiredOutputShape.summary);

  assert.ok(Array.isArray(payload.requiredOutputShape.candidates));
}

// --------------------------------------------------
// Case 2:
// Semantic tie survives into prompt.
// --------------------------------------------------

const tieContext: InvestigationNarrativeContext = {
  ...realContext,

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
      findingIds: ["finding:postgres-trace"],
      signalIds: ["signal:trace-chain"],
      reasons: ["Highest failure severity: high", "Observed failing leaf span"],
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
      findingIds: ["finding:redis-trace"],
      signalIds: ["signal:trace-chain"],
      reasons: ["Highest failure severity: high", "Observed failing leaf span"],
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
};

{
  const prompt = buildInvestigationNarrativePrompt(tieContext);

  const payload = JSON.parse(prompt.user);

  const context = payload.context as InvestigationNarrativeContext;

  assert.deepEqual(
    context.candidates.map((candidate) => candidate.rank),
    [1, 1],
  );

  assert.deepEqual(
    context.candidates.map((candidate) => candidate.tied),
    [true, true],
  );

  assert.ok(prompt.system.includes("co-equal"));
}

console.log("Investigation narrative prompt tests passed.");
