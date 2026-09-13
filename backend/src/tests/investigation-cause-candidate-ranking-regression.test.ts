import assert from "node:assert/strict";

import { InvestigationCauseCandidateFactsService } from "../services/investigation-cause-candidate-facts.service.js";
import { InvestigationCauseCandidateRankingService } from "../services/investigation-cause-candidate-ranking.service.js";
import { InvestigationCauseCandidateService } from "../services/investigation-cause-candidate.service.js";

import type { InvestigationCorrelation } from "../types/investigation-correlation.js";
import type { InvestigationEvidenceGroup } from "../types/investigation-evidence-group.js";
import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationSignal } from "../types/investigation-signal.js";
import type { TraceNode } from "../types/trace-tree.js";

const candidateService = new InvestigationCauseCandidateService();
const factsService = new InvestigationCauseCandidateFactsService();
const rankingService = new InvestigationCauseCandidateRankingService();

const traceId = "trace-alert-001";
const evidenceGroupId = "evidence_group:validated-incident";

const findings: InvestigationFinding[] = [
  {
    id: "auth-log",
    type: "log_error",
    severity: "high",
    timestamp: "2026-08-26T04:00:00.200Z",
    message: "Downstream request failed",
    service: "auth-service",
    traceId,
    spanId: "span-auth-001",
  },
  {
    id: "auth-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-26T04:00:00.000Z",
    message: "Auth request failed",
    service: "auth-service",
    traceId,
    spanId: "span-auth-001",
  },
  {
    id: "user-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-26T04:00:00.050Z",
    message: "User service failed",
    service: "user-service",
    traceId,
    spanId: "span-user-001",
  },
  {
    id: "postgres-trace",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-26T04:00:00.100Z",
    message: "Postgres query failed",
    service: "postgres",
    traceId,
    spanId: "span-db-001",
  },
  {
    id: "auth-metric",
    type: "metric_threshold",
    severity: "warning",
    timestamp: "2026-08-26T04:00:00.150Z",
    message: "Auth latency threshold exceeded",
    service: "auth-service",
  },
];

const correlations: InvestigationCorrelation[] = [
  {
    id: "same_span:span-auth-001",
    type: "same_span",
    findingIds: ["auth-log", "auth-trace"],
    traceId,
    spanId: "span-auth-001",
    message: "Auth log and trace error occurred on the same span",
  },
  {
    id: `same_trace:${traceId}`,
    type: "same_trace",
    findingIds: [
      "auth-log",
      "auth-trace",
      "user-trace",
      "postgres-trace",
    ],
    traceId,
    message: "Failure findings occurred on the same trace",
  },
  {
    id: "temporal_service:auth-service",
    type: "temporal_service",
    findingIds: ["auth-trace", "auth-log", "auth-metric"],
    service: "auth-service",
    message: "Auth findings occurred close together",
  },
];

const evidenceGroups: InvestigationEvidenceGroup[] = [
  {
    id: evidenceGroupId,
    findingIds: [
      "auth-log",
      "auth-trace",
      "user-trace",
      "postgres-trace",
      "auth-metric",
    ],
    correlationIds: correlations.map((correlation) => correlation.id),
    services: ["auth-service", "postgres", "user-service"],
    traceIds: [traceId],
    findingCount: 5,
    correlationCount: 3,
    findingTypes: ["log_error", "metric_threshold", "trace_error"],
    correlationTypes: ["same_span", "same_trace", "temporal_service"],
    startedAt: "2026-08-26T04:00:00.000Z",
    endedAt: "2026-08-26T04:00:00.200Z",
    message: "5 related findings across 3 services",
  },
];

const signals: InvestigationSignal[] = [
  {
    id: "signal:cross-service-failure",
    type: "cross_service_failure",
    evidenceGroupId,
    findingIds: ["auth-trace", "user-trace", "postgres-trace"],
    services: ["auth-service", "user-service", "postgres"],
    message: "Errors observed across the auth, user, and postgres services",
  },
  {
    id: "signal:multi-signal-evidence",
    type: "multi_signal_evidence",
    evidenceGroupId,
    findingIds: [
      "auth-log",
      "auth-trace",
      "user-trace",
      "postgres-trace",
      "auth-metric",
    ],
    services: ["auth-service", "user-service", "postgres"],
    message: "Log, trace, and metric evidence occur in the same group",
  },
  {
    id: "signal:trace-failure-chain",
    type: "trace_failure_chain",
    evidenceGroupId,
    findingIds: ["auth-trace", "user-trace", "postgres-trace"],
    traceId,
    message: "Auth, user, and postgres form a failing trace chain",
  },
];

const traces: TraceNode[] = [
  {
    traceId,
    spanId: "span-auth-001",
    service: "auth-service",
    operation: "authenticate",
    startTime: "2026-08-26T04:00:00.000Z",
    endTime: "2026-08-26T04:00:00.500Z",
    durationMs: 500,
    status: "error",
    metadata: {},
    children: [
      {
        traceId,
        spanId: "span-user-001",
        parentSpanId: "span-auth-001",
        service: "user-service",
        operation: "get_user",
        startTime: "2026-08-26T04:00:00.050Z",
        endTime: "2026-08-26T04:00:00.450Z",
        durationMs: 400,
        status: "error",
        metadata: {},
        children: [
          {
            traceId,
            spanId: "span-db-001",
            parentSpanId: "span-user-001",
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

const candidates = candidateService.createCandidates(
  evidenceGroups,
  findings,
  signals,
);

assert.deepEqual(
  candidates.map((candidate) => candidate.service),
  ["auth-service", "postgres", "user-service"],
);

const facts = factsService.createFacts(
  candidates,
  findings,
  correlations,
  signals,
  traces,
);

const authFacts = facts.find((fact) => fact.service === "auth-service");
const userFacts = facts.find((fact) => fact.service === "user-service");
const postgresFacts = facts.find((fact) => fact.service === "postgres");

assert.ok(authFacts);
assert.ok(userFacts);
assert.ok(postgresFacts);

assert.equal(authFacts.highestSeverity, "high");
assert.equal(authFacts.failureFindingCount, 2);
assert.equal(authFacts.supportDiversity, 6);
assert.equal(authFacts.observedErrorAncestorSpanCount, 1);
assert.equal(authFacts.observedLeafErrorSpanCount, 0);

assert.equal(userFacts.highestSeverity, "high");
assert.equal(userFacts.failureFindingCount, 1);
assert.equal(userFacts.supportDiversity, 4);
assert.equal(userFacts.observedErrorAncestorSpanCount, 1);
assert.equal(userFacts.observedLeafErrorSpanCount, 0);

assert.equal(postgresFacts.highestSeverity, "high");
assert.equal(postgresFacts.failureFindingCount, 1);
assert.equal(postgresFacts.supportDiversity, 4);
assert.equal(postgresFacts.observedErrorAncestorSpanCount, 0);
assert.equal(postgresFacts.observedLeafErrorSpanCount, 1);

const ranks = rankingService.createRanks(facts);

assert.deepEqual(
  ranks.map(({ service, rank, tied }) => ({ service, rank, tied })),
  [
    { service: "postgres", rank: 1, tied: false },
    { service: "auth-service", rank: 2, tied: false },
    { service: "user-service", rank: 3, tied: false },
  ],
);

assert.equal(ranks.every((rank) => rank.tied === false), true);

const authRank = ranks.find((rank) => rank.service === "auth-service");
const postgresRank = ranks.find((rank) => rank.service === "postgres");

assert.ok(authRank);
assert.ok(postgresRank);

assert.ok(postgresRank.supportDiversity < authRank.supportDiversity);
assert.equal(postgresRank.rank, 1);
assert.equal(authRank.rank, 2);

console.log("Investigation cause candidate ranking regression tests passed.");
