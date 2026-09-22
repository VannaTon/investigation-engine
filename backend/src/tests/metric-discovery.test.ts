import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { MetricDiscoveryRepository } from "../repository/metric-discovery.repository.js";
import { metricDiscoveryRoutes } from "../routes/metric-discovery.routes.js";
import {
  MetricDiscoveryInputError,
  MetricDiscoveryService,
  parseMetricDiscoveryQuery,
  parseServiceDiscoveryQuery,
} from "../services/metric-discovery.service.js";

const window = { from: "2026-09-12T01:02:03.456Z", to: "2026-09-13T01:02:03.456Z" };
const applicationId = "00000000-0000-4000-8000-000000000001";

test("discovery parsing validates original native values and preserves exact service names", () => {
  assert.deepEqual(parseServiceDiscoveryQuery({ applicationId }), { applicationId, limit: 200 });
  assert.deepEqual(parseMetricDiscoveryQuery({ applicationId, service: " Checkout / A ", limit: "500" }),
    { applicationId, service: " Checkout / A ", limit: 500 });
  for (const limit of [0, 100, true, null, [], ["2", "3"], "", "0", "501", "1.5", "1e2", "01", "+1", " 1 "]) {
    assert.throws(() => parseServiceDiscoveryQuery({ applicationId, limit }), MetricDiscoveryInputError);
  }
  for (const query of [null, [], { service: "A" }, { from: window.from }, { limit: "2", extra: true }]) {
    assert.throws(() => parseServiceDiscoveryQuery(query), MetricDiscoveryInputError);
  }
  for (const service of [undefined, null, false, 12, [], ["A", "B"], "", " \t ", "a".repeat(513)]) {
    assert.throws(() => parseMetricDiscoveryQuery({ applicationId, service }), MetricDiscoveryInputError);
  }
  for (const invalidApplicationId of [undefined, "", "not-a-uuid", 42]) {
    assert.throws(() => parseServiceDiscoveryQuery({ applicationId: invalidApplicationId }), MetricDiscoveryInputError);
  }
  assert.throws(() => parseMetricDiscoveryQuery({ applicationId, service: "A", to: window.to }), MetricDiscoveryInputError);
});

test("discovery service uses a single server-owned 24h window and echoes exact metric provenance", async () => {
  const calls: unknown[][] = [];
  let nowCalls = 0;
  const service = new MetricDiscoveryService({
    async findServices(...args) { calls.push(args); return { data: ["Checkout"], hasMore: false }; },
    async findMetrics(...args) { calls.push(args); return { data: [], hasMore: true }; },
  }, () => { nowCalls += 1; return new Date(window.to); });
  assert.deepEqual(await service.findServices({ applicationId, limit: 2 }),
    { data: ["Checkout"], hasMore: false, window });
  assert.deepEqual(await service.findMetrics({ applicationId, service: " Checkout ", limit: 3 }),
    { data: [], hasMore: true, window, service: " Checkout " });
  assert.deepEqual(calls, [[applicationId, window, 2], [applicationId, " Checkout ", window, 3]]);
  assert.equal(nowCalls, 2);
});

function fakeQueryClient(rows: unknown[]) {
  type QueryClient = NonNullable<ConstructorParameters<typeof MetricDiscoveryRepository>[0]>;
  type QueryOptions = Parameters<QueryClient["query"]>[0];
  const calls: QueryOptions[] = [];
  const client = {
    async query(options: QueryOptions) {
      calls.push(options);
      return { async json<T>() { return rows as T[]; } };
    },
  } as unknown as QueryClient;
  return { client, calls };
}

test("service discovery uses metrics-only exact recent SQL with scan budgets, stable ordering, and limit+1", async () => {
  const fake = fakeQueryClient([{ service: "A" }, { service: "B" }, { service: "C" }]);
  const repository = new MetricDiscoveryRepository(fake.client);
  assert.deepEqual(await repository.findServices(applicationId, window, 2), { data: ["A", "B"], hasMore: true });
  const call = fake.calls[0]!;
  assert.match(call.query, /FROM metrics\s/);
  assert.doesNotMatch(call.query, /spans|logs|metric_histograms|INSERT|DELETE|UPDATE/i);
  assert.match(call.query, /GROUP BY service\s+ORDER BY service ASC/);
  assert.match(call.query, /application_id = \{applicationId:UUID\}/);
  assert.match(call.query, /timestamp >= parseDateTime64BestEffort\(\{from:String\}/);
  assert.match(call.query, /timestamp <= parseDateTime64BestEffort\(\{to:String\}/);
  assert.deepEqual(call.query_params, { applicationId, ...window, limit: 3 });
  assert.deepEqual(call.clickhouse_settings, {
    max_execution_time: 5, timeout_overflow_mode: "throw", max_memory_usage: "67108864",
    max_rows_to_read: "1000000", read_overflow_mode: "throw",
  });
});

test("metric discovery binds service, keeps observed types/raw units, caps metadata, and normalizes UTC lastSeen", async () => {
  const fake = fakeQueryClient([
    { name: "a", types: ["gauge", "sum"], units: ["", "ms"], lastSeen: "2026-09-13 01:02:03.456", metadataTruncated: 0 },
    { name: "b", types: ["gauge"], units: ["bytes"], lastSeen: "2026-09-13 01:02:03", metadataTruncated: 1 },
    { name: "c", types: [], units: [], lastSeen: "2026-09-13 01:02:03", metadataTruncated: 0 },
  ]);
  const repository = new MetricDiscoveryRepository(fake.client);
  const exactService = "A' OR 1=1 --";
  assert.deepEqual(await repository.findMetrics(applicationId, exactService, window, 2), {
    data: [
      { name: "a", types: ["gauge", "sum"], units: ["", "ms"], lastSeen: window.to, metadataTruncated: false },
      { name: "b", types: ["gauge"], units: ["bytes"], lastSeen: "2026-09-13T01:02:03.000Z", metadataTruncated: true },
    ], hasMore: true,
  });
  const call = fake.calls[0]!;
  assert.match(call.query, /application_id = \{applicationId:UUID\}/);
  assert.match(call.query, /AND service = \{service:String\}/);
  assert.ok(!call.query.includes(exactService));
  assert.deepEqual(call.query_params, { applicationId, service: exactService, ...window, limit: 3 });
  assert.match(call.query, /groupUniqArray\(21\)\(type\)/);
  assert.match(call.query, /groupUniqArray\(21\)\(ifNull\(unit, ''\)\)/);
  assert.match(call.query, /arraySlice\(arraySort\(observedTypes\), 1, 20\)/);
  assert.match(call.query, /length\(observedTypes\) > 20 OR length\(observedUnits\) > 20/);
  assert.match(call.query, /GROUP BY name/);
  assert.match(call.query, /ORDER BY name ASC/);
  assert.equal(call.clickhouse_settings?.max_execution_time, 5);
});

test("empty observed storage returns a successful empty page rather than fabricated options", async () => {
  const fake = fakeQueryClient([]);
  const repository = new MetricDiscoveryRepository(fake.client);
  assert.deepEqual(await repository.findServices(applicationId, window, 200), { data: [], hasMore: false });
  assert.deepEqual(await repository.findMetrics(applicationId, "new-service", window, 200), { data: [], hasMore: false });
});

test("discovery handlers accept live data contract and reject duplicate/coerced/unsupported query values before reads", async () => {
  const calls: unknown[] = [];
  const app = Fastify({ logger: false });
  await app.register(metricDiscoveryRoutes, { queryService: {
    async findServices(query) { calls.push(query); return { data: ["Checkout"], hasMore: false, window }; },
    async findMetrics(query) { calls.push(query); return { service: query.service, data: [], hasMore: false, window }; },
  } });
  try {
    const services = await app.inject({ method: "GET", url: `/v1/metrics/discovery/services?applicationId=${applicationId}` });
    assert.equal(services.statusCode, 200);
    assert.deepEqual(services.json(), { data: ["Checkout"], hasMore: false, window });
    const metrics = await app.inject({ method: "GET", url: `/v1/metrics/discovery/metrics?applicationId=${applicationId}&service=Checkout%2FA&limit=1` });
    assert.equal(metrics.statusCode, 200);
    assert.deepEqual(metrics.json(), { service: "Checkout/A", data: [], hasMore: false, window });
    assert.deepEqual(calls, [{ applicationId, limit: 200 }, { applicationId, service: "Checkout/A", limit: 1 }]);
    for (const path of [
      "services", `services?applicationId=${applicationId}&limit=1&limit=2`,
      `services?applicationId=${applicationId}&limit=true`, `services?applicationId=${applicationId}&limit=1.5`,
      `services?applicationId=${applicationId}&limit=501`, `services?applicationId=${applicationId}&service=Checkout`,
      `services?applicationId=${applicationId}&from=2020-01-01`, "metrics?service=A",
      `metrics?applicationId=${applicationId}`, `metrics?applicationId=${applicationId}&service=`,
      `metrics?applicationId=${applicationId}&service=%20%09`, `metrics?applicationId=${applicationId}&service=A&service=B`,
      `metrics?applicationId=${applicationId}&service=A&limit=01`,
      `metrics?applicationId=${applicationId}&service=A&to=2026-09-13`,
    ]) {
      const invalid = await app.inject({ method: "GET", url: "/v1/metrics/discovery/" + path });
      assert.equal(invalid.statusCode, 400, path);
    }
    assert.equal(calls.length, 2);
  } finally { await app.close(); }
});

test("discovery storage failures are safe retryable503 responses without query or credential leakage", async () => {
  const app = Fastify({ logger: false });
  const fail = async (): Promise<never> => { throw new Error("SQL SELECT private_query password=secret credential"); };
  await app.register(metricDiscoveryRoutes, { queryService: { findServices: fail, findMetrics: fail } });
  try {
    for (const path of [`services?applicationId=${applicationId}`,
      `metrics?applicationId=${applicationId}&service=Checkout`]) {
      const response = await app.inject({ method: "GET", url: "/v1/metrics/discovery/" + path });
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), { statusCode: 503, error: "Service Unavailable",
        message: "Recent metric discovery is unavailable. Try again later." });
      assert.doesNotMatch(response.body, /private_query|password|secret|credential|SELECT/);
    }
  } finally { await app.close(); }
});
