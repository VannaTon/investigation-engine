import assert from "node:assert/strict";

import { InvestigationCauseCandidateRankingService } from "../services/investigation-cause-candidate-ranking.service.js";
import { createInvestigationRankingRationale } from "../services/investigation-ranking-rationale.service.js";
import type { InvestigationCauseCandidateFacts } from "../types/investigation-cause-candidate-facts.js";
import { createInvestigationResponseV1Fixture } from "./fixtures/investigation-response-v1.fixture.js";

const rankingService = new InvestigationCauseCandidateRankingService();

function createFacts(
  overrides: Partial<InvestigationCauseCandidateFacts> & {
    candidateId: string;
    service: string;
  },
): InvestigationCauseCandidateFacts {
  const { candidateId, service, ...optionalOverrides } = overrides;

  return {
    candidateId,
    service,
    failureFindingCount: 1,
    logErrorCount: 0,
    traceErrorCount: 1,
    highestSeverity: "high",
    traceCount: 1,
    correlationTypes: ["same_trace"],
    signalTypes: ["trace_failure_chain"],
    supportDiversity: 2,
    observedLeafErrorSpanCount: 0,
    observedErrorAncestorSpanCount: 1,
    ...optionalOverrides,
  };
}

// Case A: severity is decisive before trace position.
{
  const facts = [
    createFacts({
      candidateId: "candidate:critical-auth",
      service: "auth-service",
      highestSeverity: "critical",
    }),
    createFacts({
      candidateId: "candidate:high-postgres",
      service: "postgres",
      observedLeafErrorSpanCount: 1,
      observedErrorAncestorSpanCount: 0,
    }),
  ];
  const ranks = rankingService.createRanks(facts);
  const rationale = createInvestigationRankingRationale(ranks, facts);
  const comparison = rationale.comparisons[0];

  assert.equal(comparison?.decisiveDimension, "failure_severity");
  assert.deepEqual(comparison?.dimensionsTiedBeforeDecision, []);
  assert.match(
    comparison?.deterministicStatement ?? "",
    /critical failure severity.*high failure severity/,
  );
}

// Case B: equal severity makes trace position decisive even when the
// ancestor has more support and more failure findings.
{
  const facts = [
    createFacts({
      candidateId: "candidate:chatty-auth",
      service: "auth-service",
      supportDiversity: 6,
      failureFindingCount: 5,
    }),
    createFacts({
      candidateId: "candidate:quiet-postgres",
      service: "postgres",
      supportDiversity: 2,
      failureFindingCount: 1,
      observedLeafErrorSpanCount: 1,
      observedErrorAncestorSpanCount: 0,
    }),
  ];
  const ranks = rankingService.createRanks(facts);
  const rationale = createInvestigationRankingRationale(ranks, facts);
  const comparison = rationale.comparisons[0];

  assert.equal(comparison?.firstService, "postgres");
  assert.equal(comparison?.decisiveDimension, "trace_position");
  assert.deepEqual(comparison?.dimensionsTiedBeforeDecision, [
    "failure_severity",
  ]);
  assert.doesNotMatch(
    comparison?.deterministicStatement ?? "",
    /support diversity|failure finding count/i,
  );
}

// Support diversity is decisive; later failure count is not stated as a
// ranking reason.
{
  const facts = [
    createFacts({
      candidateId: "candidate:auth",
      service: "auth-service",
      supportDiversity: 6,
      failureFindingCount: 5,
    }),
    createFacts({
      candidateId: "candidate:user",
      service: "user-service",
      supportDiversity: 4,
      failureFindingCount: 1,
    }),
  ];
  const ranks = rankingService.createRanks(facts);
  const rationale = createInvestigationRankingRationale(ranks, facts);
  const comparison = rationale.comparisons[0];

  assert.equal(comparison?.decisiveDimension, "support_diversity");
  assert.deepEqual(comparison?.dimensionsTiedBeforeDecision, [
    "failure_severity",
    "trace_position",
  ]);
  assert.doesNotMatch(
    comparison?.deterministicStatement ?? "",
    /failure finding count/i,
  );
}

// True ties remain co-equal. candidateId only stabilizes serialization and
// never appears as a ranking dimension or reason.
{
  const facts = [
    createFacts({
      candidateId: "candidate:redis",
      service: "redis",
      observedLeafErrorSpanCount: 1,
      observedErrorAncestorSpanCount: 0,
    }),
    createFacts({
      candidateId: "candidate:postgres",
      service: "postgres",
      observedLeafErrorSpanCount: 1,
      observedErrorAncestorSpanCount: 0,
    }),
  ];
  const ranks = rankingService.createRanks(facts);
  const rationale = createInvestigationRankingRationale(ranks, facts);
  const comparison = rationale.comparisons[0];

  assert.deepEqual(rationale.candidateOrder, [
    "candidate:postgres",
    "candidate:redis",
  ]);
  assert.equal(comparison?.outcome, "tie");
  assert.equal(comparison?.decisiveDimension, "tie");
  assert.deepEqual(comparison?.dimensionsTiedBeforeDecision, [
    "failure_severity",
    "trace_position",
    "support_diversity",
    "failure_finding_count",
  ]);
  assert.match(comparison?.deterministicStatement ?? "", /co-equal/);
  assert.doesNotMatch(
    comparison?.deterministicStatement ?? "",
    /candidate.?id/i,
  );
}

// The real synthetic incident produces the expected adjacent decisions.
{
  const investigation = await createInvestigationResponseV1Fixture();
  const rationale = createInvestigationRankingRationale(
    investigation.causeCandidateRanks,
    investigation.causeCandidateFacts,
  );

  assert.equal(rationale.allCandidatesSeverityTied, true);
  assert.equal(rationale.commonSeverity, "high");
  assert.deepEqual(
    rationale.comparisons.map((comparison) => ({
      services: [comparison.firstService, comparison.secondService],
      decisiveDimension: comparison.decisiveDimension,
    })),
    [
      {
        services: ["postgres", "auth-service"],
        decisiveDimension: "trace_position",
      },
      {
        services: ["auth-service", "user-service"],
        decisiveDimension: "support_diversity",
      },
    ],
  );

  const repeated = createInvestigationRankingRationale(
    structuredClone(investigation.causeCandidateRanks),
    structuredClone(investigation.causeCandidateFacts),
  );

  assert.deepEqual(repeated, rationale);
  assert.equal(JSON.stringify(repeated), JSON.stringify(rationale));
}

console.log("Investigation ranking rationale tests passed.");
