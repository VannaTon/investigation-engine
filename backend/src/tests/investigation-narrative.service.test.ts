import assert from "node:assert/strict";

import {
  InvestigationNarrativeService,
  InvestigationNarrativeGroundingError,
  InvestigationNarrativeSemanticValidationError,
} from "../services/investigation-narrative.service.js";

import { InvestigationNarrativeOutputParseError } from "../services/investigation-narrative-output-parser.service.js";

import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

import type { InvestigationNarrativeGenerator } from "../types/investigation-narrative-generator.js";

const context: InvestigationNarrativeContext = {
  alert: {
    id: "alert-1",
    title: "High CPU",
    message: "cpu_usage exceeded threshold",
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

      findingIds: ["finding:postgres"],

      signalIds: ["signal:trace-chain"],

      reasons: ["Highest failure severity: high", "Observed failing leaf span"],
    },
  ],

  rankingRationale: {
    candidateOrder: ["candidate:postgres"],
    allCandidatesSeverityTied: true,
    commonSeverity: "high",
    comparisons: [],
  },

  findings: [
    {
      findingId: "finding:postgres",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-15T06:10:00.100Z",
      message: "Postgres trace error",
      service: "postgres",
      traceId: "trace-1",
      spanId: "span-db",
    },
  ],

  signalTypes: ["trace_failure_chain"],

  metricTimings: [],
};

class FakeGenerator implements InvestigationNarrativeGenerator {
  constructor(private readonly output: unknown) {}

  async generate(): Promise<unknown> {
    return this.output;
  }
}

// --------------------------------------------------
// Case 1:
// Valid output passes parser + grounding.
// --------------------------------------------------

{
  const generator = new FakeGenerator({
    summary: {
      text: "Postgres has supported high-severity failure evidence.",

      findingIds: ["finding:postgres"],

      signalIds: ["signal:trace-chain"],
    },

    candidates: [
      {
        candidateId: "candidate:postgres",

        text: "Postgres is ranked first for investigation and is an observed failing leaf.",

        findingIds: ["finding:postgres"],

        signalIds: ["signal:trace-chain"],
      },
    ],
  });

  const service = new InvestigationNarrativeService(generator);

  const result = await service.generate(context);

  assert.equal(result.candidates[0]?.candidateId, "candidate:postgres");

  assert.equal(result.summary.findingIds[0], "finding:postgres");
}

// --------------------------------------------------
// Case 2:
// Malformed provider output is rejected by
// runtime parsing before grounding.
// --------------------------------------------------

{
  const generator = new FakeGenerator({
    summary: "This should have been an object",

    candidates: [],
  });

  const service = new InvestigationNarrativeService(generator);

  await assert.rejects(
    () => service.generate(context),

    (error: unknown) => {
      assert.ok(error instanceof InvestigationNarrativeOutputParseError);

      assert.equal(error.path, "$.summary");

      return true;
    },
  );
}

// --------------------------------------------------
// Case 3:
// Structurally valid output containing invented
// evidence passes parsing but fails grounding.
// --------------------------------------------------

{
  const generator = new FakeGenerator({
    summary: {
      text: "Postgres has failure evidence.",

      findingIds: ["finding:does-not-exist"],

      signalIds: [],
    },

    candidates: [
      {
        candidateId: "candidate:postgres",

        text: "Postgres has failure evidence.",

        findingIds: ["finding:postgres"],

        signalIds: ["signal:trace-chain"],
      },
    ],
  });

  const service = new InvestigationNarrativeService(generator);

  await assert.rejects(
    () => service.generate(context),

    (error: unknown) => {
      assert.ok(error instanceof InvestigationNarrativeGroundingError);

      assert.ok(error.issues.some((issue) => issue.code === "unknown_finding"));

      return true;
    },
  );
}

// --------------------------------------------------
// Case 4:
// Structurally valid and grounded output is rejected
// when it contradicts deterministic ranking semantics.
// --------------------------------------------------

{
  const semanticContext = structuredClone(context);

  semanticContext.candidates.push({
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
    reasons: ["Highest failure severity: high", "Error ancestor"],
  });
  semanticContext.findings.push({
    findingId: "finding:auth",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-15T06:10:00.000Z",
    message: "Auth trace error",
    service: "auth-service",
  });
  semanticContext.rankingRationale = {
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
          "Both candidates have high failure severity. postgres ranks ahead of auth-service because trace position is the first differing ranking dimension.",
      },
    ],
  };

  const generator = new FakeGenerator({
    summary: {
      text: "Postgres has the highest failure severity.",
      findingIds: ["finding:postgres", "finding:auth"],
      signalIds: [],
    },
    candidates: [
      {
        candidateId: "candidate:postgres",
        text: "Postgres has trace failure evidence.",
        findingIds: ["finding:postgres"],
        signalIds: ["signal:trace-chain"],
      },
      {
        candidateId: "candidate:auth",
        text: "Auth-service has trace failure evidence.",
        findingIds: ["finding:auth"],
        signalIds: ["signal:trace-chain"],
      },
    ],
  });

  const service = new InvestigationNarrativeService(generator);

  await assert.rejects(
    () => service.generate(semanticContext),
    (error: unknown) => {
      assert.ok(
        error instanceof InvestigationNarrativeSemanticValidationError,
      );
      assert.ok(
        error.issues.some(
          (issue) => issue.code === "severity_tie_contradiction",
        ),
      );

      return true;
    },
  );
}

console.log("Investigation narrative service tests passed.");
