import assert from "node:assert/strict";

import { clickhouse } from "../config/clickhouse.js";
import { MetricRepository } from "../repository/metric.repository.js";
import { buildNarrativeContext } from "../services/investigation-narrative-context.service.js";
import { hashInvestigationNarrativeContext } from "../services/investigation-narrative-context-hash.service.js";
import type { InvestigationResponseV1 } from "../types/investigation-response.js";
import type { MetricEvent } from "../types/metric-event.js";
import {
  createAlertInvestigationServiceFixture,
  type InvestigationFixtureQueryLog,
  investigationResponseV1AlertId,
} from "./fixtures/investigation-response-v1.fixture.js";

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
    json: async <T>() => [] as T[],
  };
};

try {
  const repository = new MetricRepository();

  await repository.findForInvestigation(
    "auth-service",
    "2026-08-15T05:50:00.000Z",
    "2026-08-15T06:30:00.000Z",
  );

  assert.ok(captured);

  const normalizedSql = captured.query.replace(/\s+/g, " ");

  assert.match(normalizedSql, /WHERE service = \{service:String\}/);
  assert.deepEqual(captured.query_params, {
    service: "auth-service",
    from: "2026-08-15T05:50:00.000Z",
    to: "2026-08-15T06:30:00.000Z",
  });
} finally {
  queryTarget.query = originalQuery;
}

const alertServiceMetric: MetricEvent = {
  timestamp: "2026-08-15T06:10:12.778Z",
  service: "auth-service",
  name: "cpu_usage",
  type: "gauge",
  value: 92.4,
  unit: "percent",
};

const candidateServiceMetric: MetricEvent = {
  timestamp: "2026-08-15T06:10:15.000Z",
  service: "postgres",
  name: "cpu_usage",
  type: "gauge",
  value: 99,
  unit: "percent",
};

const unrelatedServiceMetric: MetricEvent = {
  timestamp: "2026-08-15T06:10:16.000Z",
  service: "shopping-service",
  name: "cpu_usage",
  type: "gauge",
  value: 99,
  unit: "percent",
};

async function investigate(
  metrics: MetricEvent[],
): Promise<InvestigationResponseV1> {
  const queryLog: InvestigationFixtureQueryLog = {
    metricWindows: [],
    metricServices: [],
    logWindows: [],
    traceWindows: [],
  };

  const service = createAlertInvestigationServiceFixture(queryLog, {
    metrics,
  });

  const response = await service.investigate(
    investigationResponseV1AlertId,
    new Date("2026-08-15T06:30:00.000Z"),
  );

  assert.deepEqual(queryLog.metricServices, ["auth-service"]);

  return response;
}

const baseline = await investigate([alertServiceMetric]);
const withCandidateServiceMetric = await investigate([
  alertServiceMetric,
  candidateServiceMetric,
]);
const withUnrelatedServiceMetric = await investigate([
  alertServiceMetric,
  unrelatedServiceMetric,
]);

assert.deepEqual(baseline.metrics, [alertServiceMetric]);
assert.ok(
  baseline.findings.some(
    (finding) =>
      finding.type === "metric_threshold" &&
      finding.service === "auth-service",
  ),
);
assert.ok(
  baseline.causeCandidates.some(
    (candidate) => candidate.service === "postgres",
  ),
);

for (const response of [
  withCandidateServiceMetric,
  withUnrelatedServiceMetric,
]) {
  assert.deepEqual(response.metrics, [alertServiceMetric]);
  assert.equal(
    response.findings.some(
      (finding) =>
        finding.type === "metric_threshold" &&
        finding.service !== "auth-service",
    ),
    false,
  );
}

const baselineContext = buildNarrativeContext(baseline);
const baselineHash = hashInvestigationNarrativeContext(baselineContext);

assert.deepEqual(
  baselineContext.metricTimings.map((timing) => timing.service),
  ["auth-service"],
);
assert.equal(
  hashInvestigationNarrativeContext(
    buildNarrativeContext(withCandidateServiceMetric),
  ),
  baselineHash,
);
assert.equal(
  hashInvestigationNarrativeContext(
    buildNarrativeContext(withUnrelatedServiceMetric),
  ),
  baselineHash,
);

console.log("Investigation metric relevance tests passed.");
