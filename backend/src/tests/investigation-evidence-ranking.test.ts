import assert from "node:assert/strict";

import { InvestigationEvidenceRankingService } from "../services/investigation-evidence-ranking.service.js";

import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationCorrelation } from "../types/investigation-correlation.js";
import type { InvestigationSignal } from "../types/investigation-signal.js";

const service = new InvestigationEvidenceRankingService();

const findings: InvestigationFinding[] = [
  {
    id: "critical-finding",
    type: "log_error",
    severity: "critical",
    timestamp: "2026-08-24T10:00:00.000Z",
    message: "Critical failure",
    service: "db",
  },
  {
    id: "high-finding",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-24T10:00:01.000Z",
    message: "High failure",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-1",
  },
  {
    id: "warning-finding",
    type: "metric_threshold",
    severity: "warning",
    timestamp: "2026-08-24T10:00:02.000Z",
    message: "Warning metric",
    service: "auth-service",
  },
  {
    id: "info-finding",
    type: "log_error",
    severity: "info",
    timestamp: "2026-08-24T10:00:03.000Z",
    message: "Informational evidence",
    service: "worker",
  },
];

const correlations: InvestigationCorrelation[] = [
  {
    id: "correlation-1",
    type: "same_trace",
    findingIds: ["high-finding"],
    message: "Same trace support",
  },

  // Same type again.
  // This must NOT add another support point.
  {
    id: "correlation-2",
    type: "same_trace",
    findingIds: ["high-finding"],
    message: "Duplicate same trace support",
  },

  {
    id: "correlation-3",
    type: "temporal_service",
    findingIds: ["high-finding"],
    message: "Temporal support",
    service: "auth-service",
  },
];

const signals: InvestigationSignal[] = [
  {
    id: "signal-1",
    type: "cross_service_failure",
    evidenceGroupId: "group-1",
    findingIds: ["high-finding"],
    message: "Cross-service failure",
  },

  // Duplicate signal type.
  // This must also NOT add another support point.
  {
    id: "signal-2",
    type: "cross_service_failure",
    evidenceGroupId: "group-2",
    findingIds: ["high-finding"],
    message: "Duplicate cross-service failure",
  },
];

const ranks = service.createRanks(findings, correlations, signals);

const criticalRank = ranks.find(
  (rank) => rank.findingId === "critical-finding",
);

const highRank = ranks.find((rank) => rank.findingId === "high-finding");

const warningRank = ranks.find((rank) => rank.findingId === "warning-finding");

const infoRank = ranks.find((rank) => rank.findingId === "info-finding");

assert.ok(criticalRank);
assert.ok(highRank);
assert.ok(warningRank);
assert.ok(infoRank);

// ----------------------------------------
// Severity ordering
// ----------------------------------------

assert.equal(criticalRank.severityRank, 3);
assert.equal(highRank.severityRank, 2);
assert.equal(warningRank.severityRank, 1);
assert.equal(infoRank.severityRank, 0);

// ----------------------------------------
// Unique support types only
// ----------------------------------------

assert.deepEqual(highRank.correlationTypes, ["same_trace", "temporal_service"]);

assert.deepEqual(highRank.signalTypes, ["cross_service_failure"]);

// 2 unique correlation types
// + 1 unique signal type
assert.equal(highRank.supportScore, 3);

// Critical finding is isolated.
assert.equal(criticalRank.supportScore, 0);

assert.deepEqual(
  ranks.map((rank) => rank.findingId),
  ["critical-finding", "high-finding", "warning-finding", "info-finding"],
);

console.log("Investigation evidence ranking tests passed.");
