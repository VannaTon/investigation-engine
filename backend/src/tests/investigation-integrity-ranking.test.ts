import assert from "node:assert/strict";

import { InvestigationCorrelationService } from "../services/investigation-correlation.service.js";
import { InvestigationEvidenceRankingService } from "../services/investigation-evidence-ranking.service.js";

import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationIntegrityIssue } from "../types/investigation-integrity-issue.js";

const correlationService = new InvestigationCorrelationService();

const rankingService = new InvestigationEvidenceRankingService();

const findings: InvestigationFinding[] = [
  {
    id: "auth-log",
    type: "log_error",
    severity: "high",
    timestamp: "2026-08-25T02:00:00.200Z",
    message: "Downstream request failed",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-user",
  },

  {
    id: "user-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-25T02:00:00.000Z",
    message: "User service failed",
    service: "user-service",
    traceId: "trace-1",
    spanId: "span-user",
  },

  {
    id: "auth-metric",
    type: "metric_threshold",
    severity: "warning",
    timestamp: "2026-08-25T02:00:10.000Z",
    message: "CPU threshold exceeded",
    service: "auth-service",
  },
];

// --------------------------------------------------
// Baseline: without integrity gating
// --------------------------------------------------

const baselineCorrelations = correlationService.createCorrelations(
  findings,
  [],
);

const baselineRanks = rankingService.createRanks(
  findings,
  baselineCorrelations,
  [],
);

const baselineLogRank = baselineRanks.find(
  (rank) => rank.findingId === "auth-log",
);

assert.ok(baselineLogRank);

assert.deepEqual(baselineLogRank.correlationTypes, [
  "same_span",
  "same_trace",
  "temporal_service",
]);

assert.equal(baselineLogRank.supportScore, 3);

// --------------------------------------------------
// Integrity issue:
// auth-service log claims user-service span
// --------------------------------------------------

const integrityIssues: InvestigationIntegrityIssue[] = [
  {
    id: "integrity:mismatch-test",
    type: "service_span_mismatch",
    message:
      "Log service auth-service does not match referenced span service user-service",

    logTimestamp: "2026-08-25T02:00:00.200Z",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-user",
  },
];

const gatedCorrelations = correlationService.createCorrelations(
  findings,
  integrityIssues,
);

const gatedRanks = rankingService.createRanks(findings, gatedCorrelations, []);

const gatedLogRank = gatedRanks.find((rank) => rank.findingId === "auth-log");

assert.ok(gatedLogRank);

// same_span must disappear.
// same_trace and temporal_service remain valid.
assert.deepEqual(gatedLogRank.correlationTypes, [
  "same_trace",
  "temporal_service",
]);

assert.equal(gatedLogRank.supportScore, 2);

// Prove malformed telemetry cannot gain
// support from the invalid span relationship.
assert.equal(baselineLogRank.supportScore - gatedLogRank.supportScore, 1);

console.log("Investigation integrity-aware ranking test passed.");
