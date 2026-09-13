import assert from "node:assert/strict";

import { InvestigationCauseCandidateService } from "../services/investigation-cause-candidate.service.js";

import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationEvidenceGroup } from "../types/investigation-evidence-group.js";
import type { InvestigationSignal } from "../types/investigation-signal.js";

const service = new InvestigationCauseCandidateService();

const findings: InvestigationFinding[] = [
  {
    id: "auth-log",
    type: "log_error",
    severity: "high",
    timestamp: "2026-08-25T03:00:00.200Z",
    message: "Downstream request failed",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-auth",
  },

  {
    id: "auth-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-25T03:00:00.000Z",
    message: "Auth request failed",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-auth",
  },

  {
    id: "user-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-25T03:00:00.050Z",
    message: "User service failed",
    service: "user-service",
    traceId: "trace-1",
    spanId: "span-user",
  },

  {
    id: "cpu-metric",
    type: "metric_threshold",
    severity: "warning",
    timestamp: "2026-08-25T03:00:10.000Z",
    message: "CPU threshold exceeded",
    service: "metric-only-service",
  },
];

const evidenceGroups: InvestigationEvidenceGroup[] = [
  {
    id: "evidence_group:test",

    findingIds: ["auth-log", "auth-trace", "user-trace", "cpu-metric"],

    correlationIds: ["same_trace:trace-1"],

    services: ["auth-service", "metric-only-service", "user-service"],

    traceIds: ["trace-1"],

    findingCount: 4,
    correlationCount: 1,

    findingTypes: ["log_error", "metric_threshold", "trace_error"],

    correlationTypes: ["same_trace"],

    startedAt: "2026-08-25T03:00:00.000Z",
    endedAt: "2026-08-25T03:00:10.000Z",

    message: "4 related findings across 3 services",
  },
];

const signals: InvestigationSignal[] = [
  {
    id: "signal:cross-service",
    type: "cross_service_failure",
    evidenceGroupId: "evidence_group:test",
    findingIds: ["auth-log", "auth-trace", "user-trace"],
    services: ["auth-service", "user-service"],
    message: "Errors observed across services",
  },

  {
    id: "signal:trace-chain",
    type: "trace_failure_chain",
    evidenceGroupId: "evidence_group:test",
    findingIds: ["auth-trace", "user-trace"],
    traceId: "trace-1",
    message: "Errors observed across trace levels",
  },
];

const candidates = service.createCandidates(evidenceGroups, findings, signals);

// --------------------------------------------------
// Only services with failure findings become candidates
// --------------------------------------------------

assert.equal(candidates.length, 2);

assert.deepEqual(
  candidates.map((candidate) => candidate.service),
  ["auth-service", "user-service"],
);

// Metric-only service must NOT become a candidate.
assert.equal(
  candidates.some((candidate) => candidate.service === "metric-only-service"),
  false,
);

// --------------------------------------------------
// Auth candidate
// --------------------------------------------------

const authCandidate = candidates.find(
  (candidate) => candidate.service === "auth-service",
);

assert.ok(authCandidate);

assert.deepEqual(authCandidate.findingIds, ["auth-log", "auth-trace"]);

assert.deepEqual(authCandidate.signalIds, [
  "signal:cross-service",
  "signal:trace-chain",
]);

assert.deepEqual(authCandidate.traceIds, ["trace-1"]);

assert.equal(authCandidate.startedAt, "2026-08-25T03:00:00.000Z");

assert.equal(authCandidate.endedAt, "2026-08-25T03:00:00.200Z");

// --------------------------------------------------
// User candidate
// --------------------------------------------------

const userCandidate = candidates.find(
  (candidate) => candidate.service === "user-service",
);

assert.ok(userCandidate);

assert.deepEqual(userCandidate.findingIds, ["user-trace"]);

assert.deepEqual(userCandidate.signalIds, [
  "signal:cross-service",
  "signal:trace-chain",
]);

console.log("Investigation cause candidate tests passed.");
