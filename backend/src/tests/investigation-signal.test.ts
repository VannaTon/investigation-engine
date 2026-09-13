import assert from "node:assert/strict";

import { InvestigationSignalService } from "../services/investigation-signal.service.js";
import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationEvidenceGroup } from "../types/investigation-evidence-group.js";
import type { TraceNode } from "../types/trace-tree.js";

const service = new InvestigationSignalService();

const findings: InvestigationFinding[] = [
  {
    id: "auth-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-24T07:00:00.000Z",
    message: "Auth trace error",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-auth",
  },
  {
    id: "auth-log",
    type: "log_error",
    severity: "high",
    timestamp: "2026-08-24T07:00:01.000Z",
    message: "Auth log error",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-auth",
  },
  {
    id: "user-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-24T07:00:02.000Z",
    message: "User trace error",
    service: "user-service",
    traceId: "trace-1",
    spanId: "span-user",
  },
  {
    id: "metric",
    type: "metric_threshold",
    severity: "high",
    timestamp: "2026-08-24T07:00:03.000Z",
    message: "CPU exceeded threshold",
    service: "auth-service",
  },
];

const evidenceGroups: InvestigationEvidenceGroup[] = [
  {
    id: "evidence_group:test-1",

    findingIds: ["auth-trace", "auth-log", "user-trace", "metric"],

    correlationIds: ["correlation-1"],

    services: ["auth-service", "user-service"],

    traceIds: ["trace-1"],

    findingCount: 4,
    correlationCount: 1,

    findingTypes: ["log_error", "metric_threshold", "trace_error"],

    correlationTypes: ["same_trace"],

    startedAt: "2026-08-24T07:00:00.000Z",
    endedAt: "2026-08-24T07:00:03.000Z",

    message: "4 related findings across 2 services",
  },
];

const signals = service.createCrossServiceFailureSignals(
  evidenceGroups,
  findings,
);

assert.equal(signals.length, 1);

const signal = signals[0];

assert.ok(signal);

assert.equal(signal.type, "cross_service_failure");

assert.equal(signal.evidenceGroupId, "evidence_group:test-1");

assert.deepEqual(signal.services, ["auth-service", "user-service"]);

assert.deepEqual(signal.findingIds, ["auth-log", "auth-trace", "user-trace"]);

// metric_threshold should NOT be part of this signal.
assert.equal(signal.findingIds.includes("metric"), false);

console.log("Investigation cross-service failure signal test passed.");

const singleServiceGroup: InvestigationEvidenceGroup[] = [
  {
    ...evidenceGroups[0]!,
    id: "evidence_group:single-service",
    findingIds: ["auth-trace", "auth-log", "metric"],
    services: ["auth-service"],
    findingCount: 3,
  },
];

const noCrossServiceSignal = service.createCrossServiceFailureSignals(
  singleServiceGroup,
  findings,
);

assert.deepEqual(noCrossServiceSignal, []);

const multiSignal = service.createMultiSignalEvidenceSignals(evidenceGroups);

assert.equal(multiSignal.length, 1);

const multiSignalResult = multiSignal[0];

assert.ok(multiSignalResult);

assert.equal(multiSignalResult.type, "multi_signal_evidence");

assert.equal(multiSignalResult.evidenceGroupId, "evidence_group:test-1");

assert.deepEqual(multiSignalResult.findingIds, [
  "auth-log",
  "auth-trace",
  "metric",
  "user-trace",
]);

const traces: TraceNode[] = [
  {
    traceId: "trace-1",
    spanId: "span-auth",
    service: "auth-service",
    operation: "login",
    startTime: "2026-08-24T07:00:00.000Z",
    endTime: "2026-08-24T07:00:00.500Z",
    durationMs: 500,
    status: "error",
    metadata: {},
    children: [
      {
        traceId: "trace-1",
        spanId: "span-user",
        parentSpanId: "span-auth",
        service: "user-service",
        operation: "get_user",
        startTime: "2026-08-24T07:00:00.050Z",
        endTime: "2026-08-24T07:00:00.450Z",
        durationMs: 400,
        status: "error",
        metadata: {},
        children: [],
      },
    ],
  },
];

const traceSignals = service.createTraceFailureChainSignals(
  evidenceGroups,
  findings,
  traces,
);

assert.equal(traceSignals.length, 1);

const traceSignal = traceSignals[0];

assert.ok(traceSignal);

assert.equal(traceSignal.type, "trace_failure_chain");

assert.equal(traceSignal.traceId, "trace-1");

assert.deepEqual(traceSignal.findingIds, ["auth-trace", "user-trace"]);

// --------------------------------------------------
// Negative case:
// sibling error spans are NOT an ancestor/descendant chain.
// --------------------------------------------------

const siblingFindings: InvestigationFinding[] = [
  {
    id: "sibling-a",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-24T08:00:00.100Z",
    message: "Sibling A failed",
    service: "service-a",
    traceId: "trace-sibling",
    spanId: "span-a",
  },
  {
    id: "sibling-b",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-24T08:00:00.200Z",
    message: "Sibling B failed",
    service: "service-b",
    traceId: "trace-sibling",
    spanId: "span-b",
  },
];

const siblingEvidenceGroups: InvestigationEvidenceGroup[] = [
  {
    id: "evidence_group:sibling-test",

    findingIds: ["sibling-a", "sibling-b"],

    correlationIds: ["same_trace:trace-sibling"],

    services: ["service-a", "service-b"],

    traceIds: ["trace-sibling"],

    findingCount: 2,
    correlationCount: 1,

    findingTypes: ["trace_error"],

    correlationTypes: ["same_trace"],

    startedAt: "2026-08-24T08:00:00.100Z",
    endedAt: "2026-08-24T08:00:00.200Z",

    message: "2 related findings across 2 services",
  },
];

const siblingTraces: TraceNode[] = [
  {
    traceId: "trace-sibling",
    spanId: "span-root",
    service: "gateway",
    operation: "request",
    startTime: "2026-08-24T08:00:00.000Z",
    endTime: "2026-08-24T08:00:01.000Z",
    durationMs: 1000,
    status: "ok",
    metadata: {},
    children: [
      {
        traceId: "trace-sibling",
        spanId: "span-a",
        parentSpanId: "span-root",
        service: "service-a",
        operation: "operation-a",
        startTime: "2026-08-24T08:00:00.100Z",
        endTime: "2026-08-24T08:00:00.400Z",
        durationMs: 300,
        status: "error",
        metadata: {},
        children: [],
      },
      {
        traceId: "trace-sibling",
        spanId: "span-b",
        parentSpanId: "span-root",
        service: "service-b",
        operation: "operation-b",
        startTime: "2026-08-24T08:00:00.200Z",
        endTime: "2026-08-24T08:00:00.500Z",
        durationMs: 300,
        status: "error",
        metadata: {},
        children: [],
      },
    ],
  },
];

const siblingSignals = service.createTraceFailureChainSignals(
  siblingEvidenceGroups,
  siblingFindings,
  siblingTraces,
);

assert.deepEqual(siblingSignals, []);
