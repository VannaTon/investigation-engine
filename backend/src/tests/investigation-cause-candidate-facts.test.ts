import assert from "node:assert/strict";

import { InvestigationCauseCandidateFactsService } from "../services/investigation-cause-candidate-facts.service.js";
import type { InvestigationCorrelation } from "../types/investigation-correlation.js";
import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationSignal } from "../types/investigation-signal.js";
import type { InvestigationCauseCandidate } from "../types/investigation-cause-candidate.js";
import type { TraceNode } from "../types/trace-tree.js";

const service = new InvestigationCauseCandidateFactsService();

const findings: InvestigationFinding[] = [
  {
    id: "auth-log",
    type: "log_error",
    severity: "high",
    timestamp: "2026-08-26T04:00:00.200Z",
    message: "Downstream request failed",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-auth",
  },

  {
    id: "auth-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-26T04:00:00.000Z",
    message: "Auth failed",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-auth",
  },

  {
    id: "user-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-26T04:00:00.050Z",
    message: "User failed",
    service: "user-service",
    traceId: "trace-1",
    spanId: "span-user",
  },

  {
    id: "db-trace",
    type: "trace_error",
    severity: "critical",
    timestamp: "2026-08-26T04:00:00.100Z",
    message: "Database failed",
    service: "postgres",
    traceId: "trace-1",
    spanId: "span-db",
  },
];

const candidates: InvestigationCauseCandidate[] = [
  {
    id: "cause_candidate:group:auth-service",
    service: "auth-service",
    findingIds: ["auth-log", "auth-trace"],
    signalIds: ["signal:trace-chain"],
    traceIds: ["trace-1"],
    startedAt: "2026-08-26T04:00:00.000Z",
    endedAt: "2026-08-26T04:00:00.200Z",
    reasons: [],
  },

  {
    id: "cause_candidate:group:user-service",
    service: "user-service",
    findingIds: ["user-trace"],
    signalIds: ["signal:trace-chain"],
    traceIds: ["trace-1"],
    startedAt: "2026-08-26T04:00:00.050Z",
    endedAt: "2026-08-26T04:00:00.050Z",
    reasons: [],
  },

  {
    id: "cause_candidate:group:postgres",
    service: "postgres",
    findingIds: ["db-trace"],
    signalIds: ["signal:trace-chain"],
    traceIds: ["trace-1"],
    startedAt: "2026-08-26T04:00:00.100Z",
    endedAt: "2026-08-26T04:00:00.100Z",
    reasons: [],
  },
];

const signals: InvestigationSignal[] = [
  {
    id: "signal:trace-chain",
    type: "trace_failure_chain",
    evidenceGroupId: "group",
    findingIds: ["auth-trace", "user-trace", "db-trace"],
    traceId: "trace-1",
    message: "Trace failure chain",
  },
];

const traces: TraceNode[] = [
  {
    traceId: "trace-1",
    spanId: "span-auth",
    service: "auth-service",
    operation: "login",
    startTime: "2026-08-26T04:00:00.000Z",
    endTime: "2026-08-26T04:00:00.500Z",
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
        startTime: "2026-08-26T04:00:00.050Z",
        endTime: "2026-08-26T04:00:00.450Z",
        durationMs: 400,
        status: "error",
        metadata: {},
        children: [
          {
            traceId: "trace-1",
            spanId: "span-db",
            parentSpanId: "span-user",
            service: "postgres",
            operation: "SELECT user",
            startTime: "2026-08-26T04:00:00.100Z",
            endTime: "2026-08-26T04:00:00.400Z",
            durationMs: 300,
            status: "error",
            metadata: {},
            children: [],
          },
        ],
      },
    ],
  },
];

const correlations: InvestigationCorrelation[] = [
  {
    id: "same-trace",
    type: "same_trace",
    findingIds: ["auth-log", "auth-trace", "user-trace", "db-trace"],
    traceId: "trace-1",
    message: "Same trace",
  },

  {
    id: "same-span-auth",
    type: "same_span",
    findingIds: ["auth-log", "auth-trace"],
    traceId: "trace-1",
    spanId: "span-auth",
    message: "Same span",
  },
];

const facts = service.createFacts(
  candidates,
  findings,
  correlations,
  signals,
  traces,
);

const authFacts = facts.find((fact) => fact.service === "auth-service");

const userFacts = facts.find((fact) => fact.service === "user-service");

const dbFacts = facts.find((fact) => fact.service === "postgres");

assert.ok(authFacts);
assert.ok(userFacts);
assert.ok(dbFacts);

// Auth has log + trace error.
assert.equal(authFacts.failureFindingCount, 2);

assert.equal(authFacts.logErrorCount, 1);

assert.equal(authFacts.traceErrorCount, 1);

// Auth is an error ancestor, not a leaf.
assert.equal(authFacts.observedErrorAncestorSpanCount, 1);

assert.equal(authFacts.observedLeafErrorSpanCount, 0);

// User is also an error ancestor.
assert.equal(userFacts.observedErrorAncestorSpanCount, 1);

assert.equal(userFacts.observedLeafErrorSpanCount, 0);

// Postgres is the observed leaf error.
assert.equal(dbFacts.observedErrorAncestorSpanCount, 0);

assert.equal(dbFacts.observedLeafErrorSpanCount, 1);

// Highest severity should be preserved.
assert.equal(authFacts.highestSeverity, "high");

assert.equal(dbFacts.highestSeverity, "critical");

assert.deepEqual(dbFacts.signalTypes, ["trace_failure_chain"]);
assert.deepEqual(authFacts.correlationTypes, ["same_span", "same_trace"]);

assert.equal(authFacts.supportDiversity, 3);

console.log("Investigation cause candidate facts tests passed.");
