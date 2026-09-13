import assert from "node:assert/strict";

import { InvestigationCauseCandidateRankingService } from "../services/investigation-cause-candidate-ranking.service.js";
import { buildNarrativeContext } from "../services/investigation-narrative-context.service.js";
import type { InvestigationCauseCandidateFacts } from "../types/investigation-cause-candidate-facts.js";
import type { InvestigationResponseV1 } from "../types/investigation-response.js";

const postgresLeaf: InvestigationCauseCandidateFacts = {
  candidateId: "candidate:postgres-leaf",
  service: "postgres",
  failureFindingCount: 1,
  logErrorCount: 0,
  traceErrorCount: 1,
  highestSeverity: "high",
  traceCount: 1,
  correlationTypes: ["same_trace", "temporal_service"],
  signalTypes: ["trace_failure_chain"],
  supportDiversity: 3,
  observedLeafErrorSpanCount: 1,
  observedErrorAncestorSpanCount: 0,
};

const redisLeaf: InvestigationCauseCandidateFacts = {
  ...postgresLeaf,
  candidateId: "candidate:redis-leaf",
  service: "redis",
};

const causeCandidateRanks =
  new InvestigationCauseCandidateRankingService().createRanks([
    redisLeaf,
    postgresLeaf,
  ]);

const investigation: InvestigationResponseV1 = {
  alert: {
    id: "alert-tied-leaves",
    ruleId: "rule-tied-leaves",
    status: "firing",
    title: "Two observed failing leaves",
    message: "Postgres and Redis remain co-equal investigation candidates",
    startedAt: "2026-08-15T06:10:00.000Z",
    createdAt: "2026-08-15T06:10:00.000Z",
    updatedAt: "2026-08-15T06:10:00.000Z",
  },
  window: {
    from: "2026-08-15T06:00:00.000Z",
    to: "2026-08-15T06:20:00.000Z",
  },
  timeline: [],
  metrics: [],
  logs: [],
  traces: [],
  summary: {
    servicesInvolved: ["postgres", "redis"],
    errorSpans: 2,
    metricAnomalies: 0,
    logErrors: 0,
  },
  findings: [
    {
      id: "finding:postgres-leaf",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-15T06:10:00.100Z",
      message: "Postgres trace leaf failed",
      service: "postgres",
      traceId: "trace-postgres",
      spanId: "span-postgres",
    },
    {
      id: "finding:redis-leaf",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-15T06:10:00.100Z",
      message: "Redis trace leaf failed",
      service: "redis",
      traceId: "trace-redis",
      spanId: "span-redis",
    },
  ],
  correlations: [],
  evidenceGroups: [],
  signals: [],
  evidenceRanks: [],
  integrityIssues: [],
  causeCandidates: [
    {
      id: redisLeaf.candidateId,
      service: redisLeaf.service,
      findingIds: ["finding:redis-leaf"],
      signalIds: [],
      traceIds: ["trace-redis"],
      startedAt: "2026-08-15T06:10:00.100Z",
      endedAt: "2026-08-15T06:10:00.100Z",
      reasons: [],
    },
    {
      id: postgresLeaf.candidateId,
      service: postgresLeaf.service,
      findingIds: ["finding:postgres-leaf"],
      signalIds: [],
      traceIds: ["trace-postgres"],
      startedAt: "2026-08-15T06:10:00.100Z",
      endedAt: "2026-08-15T06:10:00.100Z",
      reasons: [],
    },
  ],
  causeCandidateFacts: [redisLeaf, postgresLeaf],
  causeCandidateRanks,
};

const context = buildNarrativeContext(investigation);

assert.equal(context.candidates.length, 2);

assert.deepEqual(
  context.candidates.map((candidate) => candidate.rank),
  [1, 1],
);

assert.deepEqual(
  context.candidates.map((candidate) => candidate.tied),
  [true, true],
);

const postgres = context.candidates.find(
  (candidate) => candidate.service === "postgres",
);
const redis = context.candidates.find(
  (candidate) => candidate.service === "redis",
);

assert.ok(postgres);
assert.ok(redis);

assert.equal(postgres.rank, 1);
assert.equal(redis.rank, 1);
assert.equal(postgres.tied, true);
assert.equal(redis.tied, true);

assert.equal(postgres.highestSeverity, redis.highestSeverity);
assert.equal(postgres.tracePosition, redis.tracePosition);
assert.equal(postgres.supportDiversity, redis.supportDiversity);
assert.equal(postgres.failureFindingCount, redis.failureFindingCount);

// Stable serialization only.
// This ordering must not be interpreted as
// postgres outranking redis.
assert.deepEqual(
  context.candidates.map((candidate) => candidate.service),
  ["postgres", "redis"],
);

console.log("Investigation narrative context tie tests passed.");
