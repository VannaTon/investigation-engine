import assert from "node:assert/strict";

import { InvestigationCauseCandidateRankingService } from "../services/investigation-cause-candidate-ranking.service.js";

import type { InvestigationCauseCandidateFacts } from "../types/investigation-cause-candidate-facts.js";

const service = new InvestigationCauseCandidateRankingService();

// --------------------------------------------------
// Case A
// Critical ancestor must outrank high leaf.
//
// WHY:
// Failure severity is our first ranking dimension.
// A genuine critical failure outranks a high failure,
// even when the high failure is the observed trace leaf.
// --------------------------------------------------

const criticalAncestor: InvestigationCauseCandidateFacts = {
  candidateId: "candidate:auth",
  service: "auth-service",

  failureFindingCount: 1,
  logErrorCount: 0,
  traceErrorCount: 1,

  highestSeverity: "critical",

  traceCount: 1,

  correlationTypes: ["same_trace"],

  signalTypes: ["trace_failure_chain"],

  supportDiversity: 2,

  observedLeafErrorSpanCount: 0,
  observedErrorAncestorSpanCount: 1,
};

const highLeaf: InvestigationCauseCandidateFacts = {
  candidateId: "candidate:postgres",
  service: "postgres",

  failureFindingCount: 1,
  logErrorCount: 0,
  traceErrorCount: 1,

  highestSeverity: "high",

  traceCount: 1,

  correlationTypes: ["same_trace"],

  signalTypes: ["trace_failure_chain"],

  supportDiversity: 2,

  observedLeafErrorSpanCount: 1,
  observedErrorAncestorSpanCount: 0,
};

const caseA = service.createRanks([criticalAncestor, highLeaf]);

assert.deepEqual(
  caseA.map((item) => item.service),
  ["auth-service", "postgres"],
);

assert.equal(caseA[0]?.rank, 1);
assert.equal(caseA[1]?.rank, 2);

assert.equal(caseA[0]?.tracePosition, "error_ancestor");

assert.equal(caseA[1]?.tracePosition, "observed_leaf_failure");

assert.equal(caseA[0]?.tied, false);
assert.equal(caseA[1]?.tied, false);

// --------------------------------------------------
// Case B
// Same severity:
// observed leaf must outrank a chatty ancestor.
//
// WHY:
// When severity is equal, trace position is more
// meaningful for possible failure origin than raw
// telemetry/support volume.
// --------------------------------------------------

const highChattyAncestor: InvestigationCauseCandidateFacts = {
  ...criticalAncestor,

  candidateId: "candidate:chatty-auth",
  service: "auth-service",

  highestSeverity: "high",

  // Keep counts internally consistent:
  // 4 log errors + 1 trace error = 5 failures.
  failureFindingCount: 5,
  logErrorCount: 4,
  traceErrorCount: 1,

  correlationTypes: ["same_span", "same_trace", "temporal_service"],

  signalTypes: [
    "cross_service_failure",
    "multi_signal_evidence",
    "trace_failure_chain",
  ],

  supportDiversity: 6,

  observedLeafErrorSpanCount: 0,
  observedErrorAncestorSpanCount: 1,
};

const highQuietLeaf: InvestigationCauseCandidateFacts = {
  ...highLeaf,

  candidateId: "candidate:quiet-postgres",
  service: "postgres",

  highestSeverity: "high",

  supportDiversity: 2,

  failureFindingCount: 1,
  logErrorCount: 0,
  traceErrorCount: 1,

  observedLeafErrorSpanCount: 1,
  observedErrorAncestorSpanCount: 0,
};

const caseB = service.createRanks([highChattyAncestor, highQuietLeaf]);

assert.deepEqual(
  caseB.map((item) => item.service),
  ["postgres", "auth-service"],
);

assert.equal(caseB[0]?.rank, 1);
assert.equal(caseB[1]?.rank, 2);

assert.equal(caseB[0]?.tracePosition, "observed_leaf_failure");

assert.equal(caseB[1]?.tracePosition, "error_ancestor");

assert.equal(caseB[0]?.tied, false);
assert.equal(caseB[1]?.tied, false);

// --------------------------------------------------
// Case C
// Equal leaves remain semantically tied.
//
// WHY:
// If severity, trace position, support diversity,
// and failure count are all equal, we have no
// evidence-based reason to prefer one candidate.
//
// candidateId may stabilize JSON ordering,
// but must NOT break the semantic tie.
// --------------------------------------------------

const postgresLeaf: InvestigationCauseCandidateFacts = {
  ...highLeaf,

  candidateId: "candidate:postgres-leaf",
  service: "postgres",

  highestSeverity: "high",

  correlationTypes: ["same_trace", "temporal_service"],

  signalTypes: ["trace_failure_chain"],

  supportDiversity: 3,

  failureFindingCount: 1,
  logErrorCount: 0,
  traceErrorCount: 1,
};

const redisLeaf: InvestigationCauseCandidateFacts = {
  ...postgresLeaf,

  candidateId: "candidate:redis-leaf",
  service: "redis",
};

const caseC = service.createRanks([redisLeaf, postgresLeaf]);

assert.equal(caseC.length, 2);

assert.equal(caseC[0]?.rank, 1);
assert.equal(caseC[1]?.rank, 1);

assert.equal(caseC[0]?.tied, true);
assert.equal(caseC[1]?.tied, true);

// Stable serialization only.
// This does NOT mean postgres outranks redis.
assert.deepEqual(
  caseC.map((item) => item.service),
  ["postgres", "redis"],
);

console.log("Investigation cause candidate ranking policy tests passed.");
