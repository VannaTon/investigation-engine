import assert from "node:assert/strict";

import { buildNarrativeContext } from "../services/investigation-narrative-context.service.js";
import { createInvestigationResponseV1Fixture } from "./fixtures/investigation-response-v1.fixture.js";

const investigation = await createInvestigationResponseV1Fixture();
const context = buildNarrativeContext(investigation);

assert.deepEqual(
  context.candidates.map((candidate) => candidate.service),
  ["postgres", "auth-service", "user-service"],
);

assert.deepEqual(
  context.candidates.map((candidate) => candidate.rank),
  [1, 2, 3],
);

assert.equal(
  context.candidates[0]?.tracePosition,
  "observed_leaf_failure",
);
assert.equal(context.candidates[1]?.tracePosition, "error_ancestor");
assert.equal(context.candidates[2]?.tracePosition, "error_ancestor");

assert.equal(context.rankingRationale.allCandidatesSeverityTied, true);
assert.equal(context.rankingRationale.commonSeverity, "high");
assert.deepEqual(
  context.rankingRationale.candidateOrder,
  context.candidates.map((candidate) => candidate.candidateId),
);
assert.deepEqual(
  context.rankingRationale.comparisons.map((comparison) => ({
    services: [comparison.firstService, comparison.secondService],
    decisiveDimension: comparison.decisiveDimension,
    dimensionsTiedBeforeDecision:
      comparison.dimensionsTiedBeforeDecision,
  })),
  [
    {
      services: ["postgres", "auth-service"],
      decisiveDimension: "trace_position",
      dimensionsTiedBeforeDecision: ["failure_severity"],
    },
    {
      services: ["auth-service", "user-service"],
      decisiveDimension: "support_diversity",
      dimensionsTiedBeforeDecision: [
        "failure_severity",
        "trace_position",
      ],
    },
  ],
);

const postgres = context.candidates.find(
  (candidate) => candidate.service === "postgres",
);

assert.ok(postgres);
assert.equal(postgres.highestSeverity, "high");
assert.equal(postgres.supportDiversity, 4);
assert.equal(postgres.failureFindingCount, 1);

const auth = context.candidates.find(
  (candidate) => candidate.service === "auth-service",
);

assert.ok(auth);
assert.equal(auth.supportDiversity, 6);
assert.equal(auth.failureFindingCount, 2);
assert.ok(postgres.supportDiversity < auth.supportDiversity);
assert.equal(postgres.rank, 1);
assert.equal(auth.rank, 2);

const cpuTiming = context.metricTimings.find(
  (timing) =>
    timing.service === "auth-service" && timing.metricName === "cpu_usage",
);

assert.ok(cpuTiming);
assert.equal(cpuTiming.observedMetricAnomalyDeltaMs, 12_778);

assert.equal(context.findings.length, 5);

assert.deepEqual(
  [...new Set(context.findings.map((finding) => finding.type))].sort(),
  ["log_error", "metric_threshold", "trace_error"],
);

assert.deepEqual(context.signalTypes, [
  "cross_service_failure",
  "multi_signal_evidence",
  "trace_failure_chain",
]);

assert.equal(
  context.alert.id,
  "24afd0ec-1843-488c-9577-8b897eafd0c1",
);
assert.equal(context.alert.service, "auth-service");

assert.deepEqual(context.window, {
  from: "2026-08-15T05:50:00.000Z",
  to: "2026-08-15T06:30:00.000Z",
});

console.log("Investigation narrative context tests passed.");
