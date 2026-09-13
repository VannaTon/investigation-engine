import assert from "node:assert/strict";

import { clickhouse } from "../config/clickhouse.js";
import { LogRepository } from "../repository/log.repository.js";

type CapturedQuery = {
  query: string;
  query_params?: Record<string, unknown>;
};

type ClickHouseQueryTarget = {
  query(input: CapturedQuery): Promise<{
    json<T>(): Promise<T[]>;
  }>;
};

const queryTarget = clickhouse as unknown as ClickHouseQueryTarget;
const originalQuery = queryTarget.query;

let captured: CapturedQuery | undefined;

queryTarget.query = async (input) => {
  captured = input;

  return {
    json: async <T>() =>
      [
        {
          timestamp: "2026-08-15 06:10:40.000",
          service: "postgres",
          level: "error",
          message: "linked postgres failure",
          stack_trace: null,
          trace_id: "trace-alert-001",
          span_id: "span-db-001",
          environment: "production",
          metadata: "{}",
          fingerprint: "",
        },
      ] as T[],
  };
};

try {
  const repository = new LogRepository();
  const logs = await repository.findRelevantForInvestigation(
    "auth-service",
    ["trace-alert-001"],
    "2026-08-15T05:50:00.000Z",
    "2026-08-15T06:30:00.000Z",
  );

  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.service, "postgres");
  assert.equal(logs[0]?.traceId, "trace-alert-001");
  assert.equal(logs[0]?.spanId, "span-db-001");

  assert.ok(captured);

  const normalizedSql = captured.query.replace(/\s+/g, " ");

  assert.match(normalizedSql, /service = \{alertService:String\}/);
  assert.match(
    normalizedSql,
    /OR trace_id IN \{incidentTraceIds:Array\(String\)\}/,
  );
  assert.deepEqual(captured.query_params, {
    alertService: "auth-service",
    incidentTraceIds: ["trace-alert-001"],
    from: "2026-08-15T05:50:00.000Z",
    to: "2026-08-15T06:30:00.000Z",
  });
} finally {
  queryTarget.query = originalQuery;
}

console.log("Investigation log relevance repository tests passed.");
