import assert from "node:assert/strict";

import { validateNarrativeGrounding } from "../services/investigation-narrative-grounding.service.js";

import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

import type { InvestigationNarrativeOutput } from "../types/investigation-narrative-output.js";

const context: InvestigationNarrativeContext = {
  alert: {
    id: "alert-1",
    title: "Dependency failures",
    message: "Multiple dependency failures observed",
    status: "firing",
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

      findingIds: ["finding:postgres-trace"],

      signalIds: ["signal:postgres-chain"],

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

      signalIds: ["signal:redis-chain"],

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

  findings: [
    {
      findingId: "finding:postgres-trace",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-29T00:00:01.000Z",
      message: "Postgres trace error",
      service: "postgres",
      traceId: "trace-1",
      spanId: "span-postgres",
    },

    {
      findingId: "finding:redis-trace",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-29T00:00:01.100Z",
      message: "Redis trace error",
      service: "redis",
      traceId: "trace-2",
      spanId: "span-redis",
    },
  ],

  signalTypes: ["trace_failure_chain"],

  metricTimings: [],
};

function createValidOutput(): InvestigationNarrativeOutput {
  return {
    summary: {
      text: "Postgres and Redis have co-equal high-severity failure evidence.",

      findingIds: ["finding:postgres-trace", "finding:redis-trace"],

      signalIds: [],
    },

    candidates: [
      {
        candidateId: "candidate:postgres",

        text: "Postgres has high-severity trace failure evidence.",

        findingIds: ["finding:postgres-trace"],

        signalIds: ["signal:postgres-chain"],
      },

      {
        candidateId: "candidate:redis",

        text: "Redis has high-severity trace failure evidence.",

        findingIds: ["finding:redis-trace"],

        signalIds: ["signal:redis-chain"],
      },
    ],
  };
}

// --------------------------------------------------
// Case 1: Fully grounded output passes.
// --------------------------------------------------

{
  const output = createValidOutput();

  const issues = validateNarrativeGrounding(context, output);

  assert.deepEqual(issues, []);
}

// --------------------------------------------------
// Case 2: Invented finding is rejected.
// --------------------------------------------------

{
  const output = createValidOutput();

  output.candidates[0]!.findingIds = ["finding:does-not-exist"];

  const issues = validateNarrativeGrounding(context, output);

  assert.ok(issues.some((issue) => issue.code === "unknown_finding"));
}

// --------------------------------------------------
// Case 3:
// Existing finding assigned to wrong candidate
// is rejected.
// --------------------------------------------------

{
  const output = createValidOutput();

  output.candidates[0]!.findingIds = ["finding:redis-trace"];

  const issues = validateNarrativeGrounding(context, output);

  assert.ok(
    issues.some((issue) => issue.code === "candidate_finding_mismatch"),
  );
}

// --------------------------------------------------
// Case 4: Invented signal is rejected.
// --------------------------------------------------

{
  const output = createValidOutput();

  output.candidates[0]!.signalIds = ["signal:does-not-exist"];

  const issues = validateNarrativeGrounding(context, output);

  assert.ok(issues.some((issue) => issue.code === "unknown_signal"));
}

// --------------------------------------------------
// Case 5:
// Existing signal belonging to another candidate
// is rejected.
// --------------------------------------------------

{
  const output = createValidOutput();

  output.candidates[0]!.signalIds = ["signal:redis-chain"];

  const issues = validateNarrativeGrounding(context, output);

  assert.ok(issues.some((issue) => issue.code === "candidate_signal_mismatch"));
}

// --------------------------------------------------
// Case 6:
// Missing candidate is rejected.
//
// This protects semantic ties:
// the model cannot keep postgres and silently
// omit redis.
// --------------------------------------------------

{
  const output = createValidOutput();

  output.candidates = output.candidates.filter(
    (candidate) => candidate.candidateId !== "candidate:redis",
  );

  const issues = validateNarrativeGrounding(context, output);

  assert.ok(
    issues.some(
      (issue) =>
        issue.code === "missing_candidate" &&
        issue.message.includes("candidate:redis"),
    ),
  );
}

// --------------------------------------------------
// Case 7:
// Duplicate candidate explanation is rejected.
// --------------------------------------------------

{
  const output = createValidOutput();

  output.candidates.push({
    ...output.candidates[0]!,
    findingIds: [...output.candidates[0]!.findingIds],
    signalIds: [...output.candidates[0]!.signalIds],
  });

  const issues = validateNarrativeGrounding(context, output);

  assert.ok(issues.some((issue) => issue.code === "duplicate_candidate"));
}

// --------------------------------------------------
// Case 8:
// Duplicate evidence reference is rejected.
// --------------------------------------------------

{
  const output = createValidOutput();

  output.candidates[0]!.findingIds = [
    "finding:postgres-trace",
    "finding:postgres-trace",
  ];

  const issues = validateNarrativeGrounding(context, output);

  assert.ok(issues.some((issue) => issue.code === "duplicate_reference"));
}

// --------------------------------------------------
// Case 9:
// Generated text with zero grounding references
// is rejected.
// --------------------------------------------------

{
  const output = createValidOutput();

  output.candidates[0]!.findingIds = [];
  output.candidates[0]!.signalIds = [];

  const issues = validateNarrativeGrounding(context, output);

  assert.ok(issues.some((issue) => issue.code === "ungrounded_text_block"));
}

console.log("Investigation narrative grounding tests passed.");
