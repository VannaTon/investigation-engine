import assert from "node:assert/strict";

import { InvestigationCauseCandidateRankingService } from "../services/investigation-cause-candidate-ranking.service.js";
import {
  extractRankingClaims,
  validateNarrativeRankingSemantics,
} from "../services/investigation-narrative-semantic-ranking.service.js";
import { createInvestigationRankingRationale } from "../services/investigation-ranking-rationale.service.js";
import type { InvestigationCauseCandidateFacts } from "../types/investigation-cause-candidate-facts.js";
import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";
import type { InvestigationNarrativeOutput } from "../types/investigation-narrative-output.js";

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
    supportDiversity: 4,
    observedLeafErrorSpanCount: 0,
    observedErrorAncestorSpanCount: 1,
    ...optionalOverrides,
  };
}

function createContext(
  facts: InvestigationCauseCandidateFacts[],
): InvestigationNarrativeContext {
  const ranks = rankingService.createRanks(facts);
  const factsByCandidateId = new Map(
    facts.map((candidateFacts) => [
      candidateFacts.candidateId,
      candidateFacts,
    ]),
  );

  return {
    alert: {
      id: "alert-ranking",
      title: "Cross-service failure",
      message: "Failure evidence was observed",
      status: "firing",
      service: "auth-service",
    },
    window: {
      from: "2026-08-29T00:00:00.000Z",
      to: "2026-08-29T00:05:00.000Z",
    },
    candidates: ranks.map((rank) => {
      const candidateFacts = factsByCandidateId.get(rank.candidateId);

      if (!candidateFacts) {
        throw new Error("Missing candidate facts");
      }

      return {
        candidateId: rank.candidateId,
        service: rank.service,
        rank: rank.rank,
        tied: rank.tied,
        highestSeverity: candidateFacts.highestSeverity,
        tracePosition: rank.tracePosition,
        supportDiversity: rank.supportDiversity,
        failureFindingCount: rank.failureFindingCount,
        findingIds: [`finding:${rank.candidateId}`],
        signalIds: [],
        reasons: [...rank.reasons],
      };
    }),
    rankingRationale: createInvestigationRankingRationale(ranks, facts),
    findings: ranks.map((rank, index) => ({
      findingId: `finding:${rank.candidateId}`,
      type: "trace_error",
      severity: factsByCandidateId.get(rank.candidateId)!.highestSeverity,
      timestamp: `2026-08-29T00:00:0${index}.000Z`,
      message: `${rank.service} failure evidence`,
      service: rank.service,
    })),
    signalTypes: [],
    metricTimings: [],
  };
}

function createOutput(
  context: InvestigationNarrativeContext,
  text: string,
): InvestigationNarrativeOutput {
  return {
    summary: {
      text,
      findingIds: context.findings.map((finding) => finding.findingId),
      signalIds: [],
    },
    candidates: context.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      text: `${candidate.service} has deterministic failure evidence.`,
      findingIds: [candidate.findingIds[0]!],
      signalIds: [],
    })),
  };
}

function validate(
  context: InvestigationNarrativeContext,
  text: string,
) {
  return validateNarrativeRankingSemantics(
    context,
    createOutput(context, text),
  );
}

const realContext = createContext([
  createFacts({
    candidateId: "candidate:postgres",
    service: "postgres",
    observedLeafErrorSpanCount: 1,
    observedErrorAncestorSpanCount: 0,
  }),
  createFacts({
    candidateId: "candidate:auth",
    service: "auth-service",
    supportDiversity: 6,
    failureFindingCount: 2,
  }),
  createFacts({
    candidateId: "candidate:user",
    service: "user-service",
    supportDiversity: 4,
    failureFindingCount: 1,
  }),
]);

// Test A: the observed false unique-severity claim is rejected.
{
  const issues = validate(
    realContext,
    "Postgres has the highest failure severity.",
  );

  assert.ok(
    issues.some(
      (issue) => issue.code === "severity_tie_contradiction",
    ),
  );
}

// Test B: tied severity plus the authoritative trace-position rationale passes.
{
  const issues = validate(
    realContext,
    realContext.rankingRationale.comparisons
      .map((comparison) => comparison.deterministicStatement)
      .join(" "),
  );

  assert.deepEqual(issues, []);
}

// Explicitly qualified shared severity is not treated as a unique winner.
{
  const issues = validate(
    realContext,
    "Postgres has the highest failure severity, tied with auth-service and user-service.",
  );

  assert.deepEqual(issues, []);
}

// False severity superiority between tied candidates is rejected.
{
  const issues = validate(
    realContext,
    "Postgres has greater failure severity than auth-service.",
  );

  assert.ok(
    issues.some(
      (issue) => issue.code === "severity_tie_contradiction",
    ),
  );
}

// Test C: critical ancestor outranks a high leaf because severity is first.
{
  const context = createContext([
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
  ]);

  assert.deepEqual(
    validate(
      context,
      context.rankingRationale.comparisons[0]!.deterministicStatement,
    ),
    [],
  );

  const issues = validate(
    context,
    "postgres should rank first because leaf position is stronger.",
  );

  assert.ok(
    issues.some((issue) => issue.code === "wrong_candidate_order"),
  );
}

// Test D: trace position remains decisive despite later evidence volume.
{
  const context = createContext([
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
  ]);

  assert.deepEqual(
    validate(
      context,
      context.rankingRationale.comparisons[0]!.deterministicStatement,
    ),
    [],
  );

  const wrongDimension = validate(
    context,
    "postgres ranks ahead of auth-service because it has more supporting evidence.",
  );

  assert.ok(
    wrongDimension.some(
      (issue) => issue.code === "wrong_decisive_dimension",
    ),
  );
  assert.ok(
    wrongDimension.some(
      (issue) =>
        issue.code === "unused_dimension_claimed_as_decisive",
    ),
  );

  const wrongWinner = validate(
    context,
    "auth-service should rank first because it has more supporting evidence.",
  );

  assert.ok(
    wrongWinner.some(
      (issue) => issue.code === "wrong_candidate_order",
    ),
  );
}

// Test E: support diversity decides; failure count is an unused later field.
{
  const context = createContext([
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
  ]);

  assert.deepEqual(
    validate(
      context,
      context.rankingRationale.comparisons[0]!.deterministicStatement,
    ),
    [],
  );

  const issues = validate(
    context,
    "auth-service ranks ahead because it has support 6 and more failure findings.",
  );

  assert.ok(
    issues.some(
      (issue) =>
        issue.code === "unused_dimension_claimed_as_decisive",
    ),
  );
}

// Wrong adjacent order is rejected explicitly.
{
  const issues = validate(
    realContext,
    "auth-service is ranked ahead of postgres.",
  );

  assert.ok(
    issues.some((issue) => issue.code === "wrong_candidate_order"),
  );
}

// Non-adjacent reverse ordering is also rejected even though rationale data
// remains intentionally adjacent-only.
{
  const issues = validate(
    realContext,
    "user-service outranks postgres.",
  );

  assert.ok(
    issues.some((issue) => issue.code === "wrong_candidate_order"),
  );
}

// Confirmed production-pattern regression: comparison context before the true
// subject does not invent an auth-service > user-service relationship.
{
  const sourceText =
    "Compared with auth-service and user-service, postgres ranks first because it is an observed failing leaf.";
  const output = createOutput(realContext, "The candidates were compared.");
  output.candidates[0]!.text = sourceText;

  const claims = extractRankingClaims(realContext, sourceText.slice(0, -1));

  assert.equal(claims.length, 1);
  assert.equal(claims[0]!.subjectCandidateId, "candidate:postgres");
  assert.equal(claims[0]!.subjectService, "postgres");
  assert.equal(claims[0]!.relation, "ranks_ahead");
  assert.deepEqual(claims[0]!.comparedCandidateIds, [
    "candidate:auth",
    "candidate:user",
  ]);
  assert.deepEqual(claims[0]!.comparedServices, [
    "auth-service",
    "user-service",
  ]);
  assert.equal(claims[0]!.matchedClause, "it is an observed failing leaf");
  assert.deepEqual(claims[0]!.detectedDimensions, ["trace_position"]);
  assert.deepEqual(validateNarrativeRankingSemantics(realContext, output), []);
}

// A trailing while-clause describing lower-ranked services is not a relation
// between those services and is excluded from the local reason clause.
{
  const sourceText =
    "Postgres ranks first because it is an observed failing leaf, while auth-service and user-service are error ancestors.";
  const output = createOutput(realContext, "The candidates were compared.");
  output.candidates[0]!.text = sourceText;

  assert.deepEqual(validateNarrativeRankingSemantics(realContext, output), []);
}

// A clear auth-service > user-service claim with the authoritative reason passes.
{
  const text =
    "Auth-service ranks ahead of user-service because structural support diversity is higher.";
  const claims = extractRankingClaims(realContext, text.slice(0, -1));

  assert.equal(claims.length, 1);
  assert.equal(claims[0]!.subjectCandidateId, "candidate:auth");
  assert.deepEqual(claims[0]!.comparedCandidateIds, ["candidate:user"]);
  assert.deepEqual(claims[0]!.detectedDimensions, [
    "support_diversity",
  ]);

  assert.deepEqual(
    validate(realContext, text),
    [],
  );
}

// A clear auth-service > user-service claim with the wrong reason is rejected,
// and every diagnostic field describes that local claim.
{
  const sourceText =
    "Auth-service ranks ahead of user-service because trace position is stronger.";
  const output = createOutput(realContext, "The candidates were compared.");
  output.candidates[0]!.text = sourceText;

  const issue = validateNarrativeRankingSemantics(
    realContext,
    output,
  ).find(
    (candidateIssue) =>
      candidateIssue.code === "wrong_decisive_dimension",
  );

  assert.ok(issue);
  assert.equal(issue.path, "candidates[0].text");
  assert.equal(issue.sourceText, sourceText.slice(0, -1));
  assert.equal(issue.matchedClause, "trace position is stronger");
  assert.deepEqual(issue.matchedCandidateIds, [
    "candidate:auth",
    "candidate:user",
  ]);
  assert.deepEqual(issue.matchedServices, ["auth-service", "user-service"]);
  assert.equal(issue.expectedDimension, "support_diversity");
  assert.equal(issue.detectedDimension, "trace_position");
}

// Merely describing two candidates with the same trace role is not ranking.
{
  assert.deepEqual(
    validate(
      realContext,
      "Auth-service and user-service are both error ancestors.",
    ),
    [],
  );
}

// Clear PostgreSQL ranking reasons still validate in both directions.
{
  assert.deepEqual(
    validate(
      realContext,
      "Postgres ranks ahead of auth-service because it is an observed failing leaf.",
    ),
    [],
  );

  const issues = validate(
    realContext,
    "Postgres ranks ahead of auth-service because it has more supporting evidence.",
  );
  const issue = issues.find(
    (candidateIssue) =>
      candidateIssue.code === "wrong_decisive_dimension",
  );

  assert.ok(issue);
  assert.equal(issue.expectedDimension, "trace_position");
  assert.equal(issue.detectedDimension, "support_diversity");
  assert.equal(issue.matchedClause, "it has more supporting evidence");
  assert.deepEqual(issue.matchedCandidateIds, [
    "candidate:postgres",
    "candidate:auth",
  ]);
  assert.deepEqual(issue.matchedServices, ["postgres", "auth-service"]);
}

// Separate sentences produce separate local claims and reasons.
{
  assert.deepEqual(
    validate(
      realContext,
      "Postgres ranks ahead of auth-service because it is an observed failing leaf. Auth-service ranks ahead of user-service because support diversity is 6 versus 4.",
    ),
    [],
  );
}

// A later contrast clause cannot leak a second dimension into the ranking reason.
{
  assert.deepEqual(
    validate(
      realContext,
      "Postgres ranks ahead of auth-service because of trace position, while auth-service has greater support diversity.",
    ),
    [],
  );
}

// Elliptical ranking language without a confidently adjacent subject is skipped.
{
  assert.deepEqual(
    validate(
      realContext,
      "Postgres has higher support diversity than auth-service, but ranks first because of trace position.",
    ),
    [],
  );
}

// Test F: true ties are co-equal and cannot have a unique leader.
{
  const context = createContext([
    createFacts({
      candidateId: "candidate:a",
      service: "A",
      observedLeafErrorSpanCount: 1,
      observedErrorAncestorSpanCount: 0,
    }),
    createFacts({
      candidateId: "candidate:b",
      service: "B",
      observedLeafErrorSpanCount: 1,
      observedErrorAncestorSpanCount: 0,
    }),
  ]);

  assert.deepEqual(
    validate(
      context,
      "A and B are co-equal at rank 1.",
    ),
    [],
  );

  const issues = validate(
    context,
    "A is the leading candidate over B.",
  );
  const issue = issues.find(
    (candidateIssue) => candidateIssue.code === "tie_violation",
  );

  assert.ok(issue);
  assert.equal(issue.sourceText, "A is the leading candidate over B");
  assert.equal(issue.matchedClause, issue.sourceText);
  assert.deepEqual(issue.matchedCandidateIds, [
    "candidate:a",
    "candidate:b",
  ]);
  assert.deepEqual(issue.matchedServices, ["A", "B"]);
}

console.log("Investigation narrative semantic ranking tests passed.");
