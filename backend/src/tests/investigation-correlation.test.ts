import { InvestigationCorrelationService } from "../services/investigation-correlation.service.js";
import type { InvestigationFinding } from "../types/investigation-finding.js";

const service = new InvestigationCorrelationService();

const findings: InvestigationFinding[] = [
  {
    id: "a",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-23T10:00:00.000Z",
    message: "A",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-1",
  },
  {
    id: "b",
    type: "log_error",
    severity: "high",
    timestamp: "2026-08-23T10:00:10.000Z",
    message: "B",
    service: "auth-service",
    traceId: "trace-1",
    spanId: "span-1",
  },
  {
    id: "c",
    type: "metric_threshold",
    severity: "high",
    timestamp: "2026-08-23T10:00:20.000Z",
    message: "C",
    service: "auth-service",
  },
  {
    id: "d",
    type: "log_error",
    severity: "high",
    timestamp: "2026-08-23T10:01:20.000Z",
    message: "D",
    service: "auth-service",
  },
  {
    id: "e",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-23T10:01:30.000Z",
    message: "E",
    service: "auth-service",
    traceId: "trace-2",
    spanId: "span-2",
  },
  {
    id: "f",
    type: "trace_error",
    severity: "high",
    timestamp: "2026-08-23T10:00:05.000Z",
    message: "F",
    service: "user-service",
    traceId: "trace-1",
    spanId: "span-user",
  },
];

import assert from "node:assert/strict";

const correlations = service.createCorrelations(findings);

assert.equal(correlations.length, 4);

const sameSpan = correlations.find(
  (correlation) => correlation.type === "same_span",
);

assert.ok(sameSpan);
assert.deepEqual(sameSpan.findingIds, ["a", "b"]);
assert.equal(sameSpan.traceId, "trace-1");
assert.equal(sameSpan.spanId, "span-1");

const sameTrace = correlations.find(
  (correlation) => correlation.type === "same_trace",
);

assert.ok(sameTrace);
assert.deepEqual(sameTrace.findingIds, ["a", "b", "f"]);
assert.equal(sameTrace.traceId, "trace-1");

const temporal = correlations.filter(
  (correlation) => correlation.type === "temporal_service",
);

assert.equal(temporal.length, 2);

assert.deepEqual(temporal[0]?.findingIds, ["a", "b", "c"]);

assert.deepEqual(temporal[1]?.findingIds, ["d", "e"]);

console.log("Investigation correlation tests passed.");
