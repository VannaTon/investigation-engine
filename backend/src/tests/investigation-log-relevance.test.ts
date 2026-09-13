import assert from "node:assert/strict";

import { buildNarrativeContext } from "../services/investigation-narrative-context.service.js";
import { hashInvestigationNarrativeContext } from "../services/investigation-narrative-context-hash.service.js";
import type { InvestigationResponseV1 } from "../types/investigation-response.js";
import type { LogEvent } from "../types/log-event.js";
import {
  createAlertInvestigationServiceFixture,
  investigationResponseV1AlertId,
} from "./fixtures/investigation-response-v1.fixture.js";

const alertServiceLog: LogEvent = {
  timestamp: "2026-08-15T06:10:45.000Z",
  service: "auth-service",
  level: "error",
  message: "alert-service-no-trace",
};

const linkedPostgresLog: LogEvent = {
  timestamp: "2026-08-15T06:10:40.000Z",
  service: "postgres",
  level: "error",
  message: "linked-postgres-log",
  traceId: "trace-alert-001",
  spanId: "span-db-001",
};

const linkedUserLog: LogEvent = {
  timestamp: "2026-08-15T06:10:42.000Z",
  service: "user-service",
  level: "error",
  message: "linked-user-log",
  traceId: "trace-alert-001",
  spanId: "span-user-001",
};

const unlinkedPostgresLog: LogEvent = {
  timestamp: "2026-08-15T06:10:35.000Z",
  service: "postgres",
  level: "error",
  message: "unlinked-postgres-log",
};

const unrelatedShoppingLog: LogEvent = {
  timestamp: "2026-08-15T06:10:36.000Z",
  service: "shopping-service",
  level: "error",
  message: "unrelated-shopping-log",
};

const mismatchedSpanOwnerLog: LogEvent = {
  timestamp: "2026-08-15T06:10:43.000Z",
  service: "postgres",
  level: "error",
  message: "mismatched-span-owner-log",
  traceId: "trace-alert-001",
  spanId: "span-user-001",
};

async function investigate(logs: LogEvent[]): Promise<InvestigationResponseV1> {
  const service = createAlertInvestigationServiceFixture(undefined, {
    logs,
  });

  return service.investigate(
    investigationResponseV1AlertId,
    new Date("2026-08-15T06:30:00.000Z"),
  );
}

const relevantLogs = [
  alertServiceLog,
  linkedPostgresLog,
  linkedUserLog,
  mismatchedSpanOwnerLog,
];

const relevantOnly = await investigate(relevantLogs);
const withExcludedNoise = await investigate([
  ...relevantLogs,
  unlinkedPostgresLog,
  unrelatedShoppingLog,
]);

assert.deepEqual(
  withExcludedNoise.logs.map((log) => log.message),
  relevantLogs.map((log) => log.message),
);
assert.equal(
  withExcludedNoise.logs.some(
    (log) => log.message === unlinkedPostgresLog.message,
  ),
  false,
);
assert.equal(
  withExcludedNoise.logs.some(
    (log) => log.message === unrelatedShoppingLog.message,
  ),
  false,
);

const postgresLogFinding = withExcludedNoise.findings.find(
  (finding) => finding.message === linkedPostgresLog.message,
);
const postgresTraceFinding = withExcludedNoise.findings.find(
  (finding) =>
    finding.type === "trace_error" &&
    finding.traceId === linkedPostgresLog.traceId &&
    finding.spanId === linkedPostgresLog.spanId,
);

assert.ok(postgresLogFinding);
assert.ok(postgresTraceFinding);

const postgresSameSpan = withExcludedNoise.correlations.find(
  (correlation) =>
    correlation.type === "same_span" &&
    correlation.traceId === linkedPostgresLog.traceId &&
    correlation.spanId === linkedPostgresLog.spanId,
);

assert.ok(postgresSameSpan);
assert.ok(postgresSameSpan.findingIds.includes(postgresLogFinding.id));
assert.ok(postgresSameSpan.findingIds.includes(postgresTraceFinding.id));

const mismatchFinding = withExcludedNoise.findings.find(
  (finding) => finding.message === mismatchedSpanOwnerLog.message,
);
const mismatchIssue = withExcludedNoise.integrityIssues.find(
  (issue) =>
    issue.type === "service_span_mismatch" &&
    issue.logTimestamp === mismatchedSpanOwnerLog.timestamp,
);

assert.ok(mismatchFinding);
assert.ok(mismatchIssue);
assert.equal(
  withExcludedNoise.correlations
    .filter((correlation) => correlation.type === "same_span")
    .some((correlation) => correlation.findingIds.includes(mismatchFinding.id)),
  false,
);

const incidentSameTrace = withExcludedNoise.correlations.find(
  (correlation) =>
    correlation.type === "same_trace" &&
    correlation.traceId === "trace-alert-001",
);

assert.ok(incidentSameTrace);
assert.ok(incidentSameTrace.findingIds.includes(mismatchFinding.id));

assert.deepEqual(
  withExcludedNoise.causeCandidateRanks,
  relevantOnly.causeCandidateRanks,
);
assert.deepEqual(
  withExcludedNoise.causeCandidateFacts,
  relevantOnly.causeCandidateFacts,
);

const baseline = await investigate([alertServiceLog]);
const linkedEvidence = await investigate([
  alertServiceLog,
  linkedPostgresLog,
]);
const irrelevantEvidence = await investigate([
  alertServiceLog,
  unlinkedPostgresLog,
  unrelatedShoppingLog,
]);
const linkedEvidenceAgain = await investigate([
  alertServiceLog,
  linkedPostgresLog,
]);

const baselineContext = buildNarrativeContext(baseline);
const linkedContext = buildNarrativeContext(linkedEvidence);
const irrelevantContext = buildNarrativeContext(irrelevantEvidence);

const baselineHash = hashInvestigationNarrativeContext(baselineContext);
const linkedHash = hashInvestigationNarrativeContext(linkedContext);

assert.notEqual(linkedHash, baselineHash);
assert.equal(
  hashInvestigationNarrativeContext(irrelevantContext),
  baselineHash,
);
assert.equal(
  hashInvestigationNarrativeContext(
    buildNarrativeContext(linkedEvidenceAgain),
  ),
  linkedHash,
);
assert.ok(
  linkedContext.findings.some(
    (finding) => finding.message === linkedPostgresLog.message,
  ),
);

assert.deepEqual(
  Object.keys(withExcludedNoise).sort(),
  Object.keys(baseline).sort(),
);

console.log("Investigation log relevance tests passed.");
