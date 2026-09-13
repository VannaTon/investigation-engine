import assert from "node:assert/strict";

import { InvestigationEvidenceGroupService } from "../services/investigation-evidence-group.service.js";
import type { InvestigationFinding } from "../types/investigation-finding.js";
import type { InvestigationCorrelation } from "../types/investigation-correlation.js";

const service = new InvestigationEvidenceGroupService();

const findings: InvestigationFinding[] = [
  {
    id: "a",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-24T01:00:00.000Z",
    message: "A",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-a",
  },
  {
    id: "b",
    type: "log_error",
    severity: "high",
    timestamp: "2026-08-24T01:00:01.000Z",
    message: "B",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-a",
  },
  {
    id: "c",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-24T01:00:02.000Z",
    message: "C",
    service: "user-service",
    traceId: "trace-1",
    spanId: "span-c",
  },

  {
    id: "d",
    type: "log_error",
    severity: "high",
    timestamp: "2026-08-24T02:00:00.000Z",
    message: "D",
    service: "payment-service",
    traceId: "trace-2",
    spanId: "span-d",
  },
  {
    id: "e",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-24T02:00:01.000Z",
    message: "E",
    service: "postgres",
    traceId: "trace-2",
    spanId: "span-e",
  },

  // No correlation should leave this outside all groups.
  {
    id: "f",
    type: "metric_threshold",
    severity: "high",
    timestamp: "2026-08-24T03:00:00.000Z",
    message: "F",
    service: "worker-service",
  },
];

const correlations: InvestigationCorrelation[] = [
  {
    id: "correlation-1",
    type: "same_span",
    findingIds: ["a", "b"],
    traceId: "trace-1",
    spanId: "span-a",
    message: "A and B share a span",
  },

  // This joins C to the A/B component.
  {
    id: "correlation-2",
    type: "same_trace",
    findingIds: ["b", "c"],
    traceId: "trace-1",
    message: "B and C share a trace",
  },

  // Separate component.
  {
    id: "correlation-3",
    type: "same_trace",
    findingIds: ["d", "e"],
    traceId: "trace-2",
    message: "D and E share a trace",
  },
];

const groups = service.createGroups(findings, correlations);

// A-B-C and D-E.
// F should not become a group.
assert.equal(groups.length, 2);

const abcGroup = groups.find(
  (group) =>
    group.findingIds.includes("a") &&
    group.findingIds.includes("b") &&
    group.findingIds.includes("c"),
);

assert.ok(abcGroup);

assert.deepEqual(abcGroup.findingIds, ["a", "b", "c"]);

assert.deepEqual([...abcGroup.correlationIds].sort(), [
  "correlation-1",
  "correlation-2",
]);

assert.deepEqual([...abcGroup.services].sort(), [
  "auth-service",
  "user-service",
]);

assert.deepEqual(abcGroup.traceIds, ["trace-1"]);

const deGroup = groups.find(
  (group) => group.findingIds.includes("d") && group.findingIds.includes("e"),
);

assert.ok(deGroup);

assert.deepEqual(deGroup.findingIds, ["d", "e"]);

assert.deepEqual(deGroup.correlationIds, ["correlation-3"]);

assert.deepEqual([...deGroup.services].sort(), ["payment-service", "postgres"]);

assert.deepEqual(deGroup.traceIds, ["trace-2"]);

// Isolated F must not appear in any evidence group.
assert.equal(
  groups.some((group) => group.findingIds.includes("f")),
  false,
);

// IDs should be deterministic regardless of input ordering.
const reorderedGroups = service.createGroups(
  [...findings].reverse(),
  [...correlations].reverse(),
);

const reorderedAbcGroup = reorderedGroups.find(
  (group) =>
    group.findingIds.includes("a") &&
    group.findingIds.includes("b") &&
    group.findingIds.includes("c"),
);

assert.ok(reorderedAbcGroup);
assert.deepEqual(abcGroup.findingIds, reorderedAbcGroup.findingIds);

assert.deepEqual(abcGroup.correlationIds, reorderedAbcGroup.correlationIds);

assert.deepEqual(abcGroup.services, reorderedAbcGroup.services);

assert.deepEqual(abcGroup.traceIds, reorderedAbcGroup.traceIds);
assert.equal(abcGroup.id, reorderedAbcGroup.id);

console.log("Investigation evidence group tests passed.");
