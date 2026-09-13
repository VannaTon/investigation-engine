import assert from "node:assert/strict";

import { InvestigationIntegrityService } from "../services/investigation-integrity.service.js";

import type { LogEvent } from "../types/log-event.js";
import type { TraceNode } from "../types/trace-tree.js";

const service = new InvestigationIntegrityService();

const traces: TraceNode[] = [
  {
    traceId: "trace-1",
    spanId: "span-auth",
    service: "auth-service",
    operation: "login",
    startTime: "2026-08-25T00:00:00.000Z",
    endTime: "2026-08-25T00:00:01.000Z",
    durationMs: 1000,
    status: "error",
    metadata: {},
    children: [
      {
        traceId: "trace-1",
        spanId: "span-user",
        parentSpanId: "span-auth",
        service: "user-service",
        operation: "get_user",
        startTime: "2026-08-25T00:00:00.100Z",
        endTime: "2026-08-25T00:00:00.800Z",
        durationMs: 700,
        status: "error",
        metadata: {},
        children: [],
      },
    ],
  },
];

// --------------------------------------------------
// 1. Valid log → span relationship
// --------------------------------------------------

const validLogs: LogEvent[] = [
  {
    timestamp: "2026-08-25T00:00:00.200Z",
    service: "auth-service",
    level: "error",
    message: "Login failed",
    metadata: {},
    traceId: "trace-1",
    spanId: "span-auth",
  },
];

const validIssues = service.validateLogs(validLogs, traces);

assert.deepEqual(validIssues, []);

// --------------------------------------------------
// 2. Log service does not match span service
// --------------------------------------------------

const mismatchedLogs: LogEvent[] = [
  {
    timestamp: "2026-08-25T00:00:00.300Z",
    service: "auth-service",
    level: "error",
    message: "Database timeout",
    metadata: {},
    traceId: "trace-1",
    spanId: "span-user",
  },
];

const mismatchIssues = service.validateLogs(mismatchedLogs, traces);

assert.equal(mismatchIssues.length, 1);

assert.equal(mismatchIssues[0]?.type, "service_span_mismatch");

assert.equal(mismatchIssues[0]?.traceId, "trace-1");

assert.equal(mismatchIssues[0]?.spanId, "span-user");

// --------------------------------------------------
// 3. Referenced span does not exist
// --------------------------------------------------

const missingSpanLogs: LogEvent[] = [
  {
    timestamp: "2026-08-25T00:00:00.400Z",
    service: "auth-service",
    level: "error",
    message: "Unknown span",
    metadata: {},
    traceId: "trace-1",
    spanId: "span-does-not-exist",
  },
];

const missingSpanIssues = service.validateLogs(missingSpanLogs, traces);

assert.equal(missingSpanIssues.length, 1);

assert.equal(missingSpanIssues[0]?.type, "missing_span_reference");

assert.equal(missingSpanIssues[0]?.traceId, "trace-1");

assert.equal(missingSpanIssues[0]?.spanId, "span-does-not-exist");

console.log("Investigation integrity tests passed.");

const missingTraceLogs: LogEvent[] = [
  {
    timestamp: "2026-08-25T00:00:00.500Z",
    service: "payment-service",
    level: "error",
    message: "Unknown trace",
    metadata: {},
    traceId: "trace-does-not-exist",
    spanId: "span-123",
  },
];

const missingTraceIssues = service.validateLogs(missingTraceLogs, traces);

assert.equal(missingTraceIssues.length, 1);

assert.equal(missingTraceIssues[0]?.type, "missing_trace_reference");
