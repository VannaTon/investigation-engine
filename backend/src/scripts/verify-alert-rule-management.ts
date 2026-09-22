import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import type { Pool } from "pg";
import { postgres } from "../config/postgres.js";
import { clickhouse } from "../config/clickhouse.js";
import { connectRedis, redis } from "../config/redis.js";
import { alertRuleService, alertService, alertInvestigationService } from "../composition/alert-rule.js";
import { metricService } from "../composition/metrics.js";
import { alertRuleRoutes } from "../routes/alert-rule.routes.js";
import { alertRoutes } from "../routes/alert.routes.js";
import { otlpMetricRoute } from "../routes/otlp-metric.routes.js";
import { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import { MetricRepository } from "../repository/metric.repository.js";
import type { AlertRule, AlertRuleEditContext, AlertRuleReplacement, MetricThresholdRuleConfig } from "../types/alert.js";
import type { InvestigationResponseV1 } from "../types/investigation-response.js";
import { LOCAL_DEVELOPMENT_APPLICATION_ID } from "../types/application.js";

// Run from backend with the existing stack/metric worker already running.
// No listener, schema initializer, provider request, worker start, ACK, or DLQ write.
const app = Fastify({ logger: false });
const runId = randomUUID();
const marker = `alert-rule-verification-${runId}`;
const service = marker;
const metricName = `${marker}.queue.depth`;
const applicationId = LOCAL_DEVELOPMENT_APPLICATION_ID;
const authenticator = { authenticateAuthorizationHeader: async () => applicationId };
const owned = new Map<string, string>();
const published = new Set<string>();
const repository = new AlertRuleRepository();
const metrics = new MetricRepository();
const config: MetricThresholdRuleConfig = {
  service, metricName, operator: ">", threshold: 100,
  windowMinutes: 5, recoveryWindowMinutes: 3, stalenessMinutes: 1,
};
let cleaned = 0;
let result: Record<string, unknown> | undefined;
let cleanupFailed = false;
let checkpoint = "initialization";

async function request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", url: string,
  payload?: unknown, expected = 200): Promise<T> {
  checkpoint = `${method} ${url}`;
  const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  assert.equal(response.statusCode, expected, `${method} ${url}: expected ${expected}, got ${response.statusCode}`);
  return (response.body ? response.json() : undefined) as T;
}

async function create(suffix: string): Promise<AlertRule> {
  const name = `${marker}-${suffix}`;
  const rule = await request<AlertRule>("POST", "/v1/alert-rules", {
    applicationId,
    name, type: "metric_threshold", enabled: false, config,
  }, 201);
  owned.set(rule.id, name);
  assert.equal(rule.name, name);
  assert.equal(rule.enabled, false);
  return rule;
}

async function poll<T>(label: string, read: () => Promise<T | undefined>): Promise<T> {
  checkpoint = label;
  const deadline = Date.now() + 45_000;
  do {
    const value = await read();
    if (value !== undefined) return value;
    await delay(500);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}; no worker or stack was restarted.`);
}

async function alertRows(id: string) {
  return (await postgres.query<{ id: string; status: string; rule_id: string; title: string; message: string }>(
    "SELECT id, status, rule_id, title, message FROM alerts WHERE rule_id = $1 ORDER BY id", [id],
  )).rows;
}

async function sendGauge(value: number): Promise<void> {
  const body = {
    resourceMetrics: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
      scopeMetrics: [{ scope: { name: "alert-rule-management-verification" }, metrics: [{
        name: metricName, unit: "items", gauge: { dataPoints: [{
          timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(), asDouble: value,
        }] },
      }] }],
    }],
  };
  await request("POST", "/otlp/v1/metrics", body);
  await poll(`Gauge ${value} stored by the existing metric worker`, async () => {
    const found = await metrics.find({ applicationId, service, name: metricName, limit: 100 });
    return found.data.find((sample) => sample.value === value);
  });
  await waitForAcknowledgements();
}

async function preflight(): Promise<void> {
  for (const url of ["http://127.0.0.1:3000/health", "http://127.0.0.1:8123/ping"]) {
    checkpoint = `preflight ${url}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    assert.equal(response.ok, true, `Not ready: ${new URL(url).pathname}`);
    await response.text();
  }
  // Require an existing real worker rather than starting a consumer of user PELs.
  checkpoint = "preflight existing metric worker process";
  assert.ok(execFileSync("pgrep", ["-f", "[s]rc/worker/metric.worker.ts"], { encoding: "utf8" }).trim(), "Metric worker missing");
  checkpoint = "preflight PostgreSQL alert tables";
  await postgres.query("SELECT id, name, enabled, config, updated_at FROM alert_rules LIMIT 0");
  await postgres.query("SELECT id, rule_id, status FROM alerts LIMIT 0");
  checkpoint = "preflight Redis metric worker group";
  await connectRedis();
  await redis.xInfoConsumers("metrics", "metric_workers");
  checkpoint = "preflight ClickHouse telemetry tables";
  const tables = await clickhouse.query({
    query: "SELECT name FROM system.tables WHERE database = 'observability' AND name IN ('metrics', 'logs', 'spans')",
    format: "JSONEachRow",
  });
  assert.deepEqual((await tables.json<{ name: string }>()).map((row) => row.name).sort(), ["logs", "metrics", "spans"]);
  await app.register(alertRuleRoutes, { alertRuleService });
  await app.register(alertRoutes, { alertService, alertInvestigationService, getNarrativeService: () => undefined });
  await app.register(otlpMetricRoute, { authenticator, metricIngestionService: {
    ingest: async (event) => {
      assert.equal(event.service, service);
      assert.equal(event.name, metricName);
      const accepted = await metricService.ingest(event);
      published.add(accepted.evenId);
      return accepted;
    },
  } });
  await app.ready();
  console.log(JSON.stringify({ event: "alert_rule_verification_preflight_ready", runId, disposableWritesOnly: true }));
}

async function waitForAcknowledgements(): Promise<void> {
  if (!published.size) return;
  await poll("disposable messages delivered and acknowledged", async () => {
    const group = (await redis.xInfoGroups("metrics")).find((entry) => entry.name === "metric_workers");
    if (!group) return undefined;
    // The installed Redis client types this RESP2 string field as a number.
    const lastDeliveredId: unknown = group["last-delivered-id"];
    assert.equal(typeof lastDeliveredId, "string");
    const [deliveredMs, deliveredSequence] = (lastDeliveredId as string).split("-").map(BigInt);
    for (const id of published) {
      const [ms, sequence] = id.split("-").map(BigInt);
      if (ms! > deliveredMs! || ms === deliveredMs && sequence! > deliveredSequence!) return undefined;
      if ((await redis.xPendingRange("metrics", "metric_workers", id, id, 1)).length) return undefined;
    }
    return true;
  });
}

async function verify(): Promise<void> {
  await preflight();
  const original = await create("gauge");
  await request("PATCH", `/v1/alert-rules/${original.id}`, { enabled: true });
  await sendGauge(50);
  // sendGauge waits for storage and the worker's post-evaluation ACK.
  assert.deepEqual(await alertRows(original.id), []);
  await sendGauge(120);
  const alert = await poll("threshold-created alert", async () => (await alertRows(original.id))[0]);
  assert.equal(alert.status, "firing");
  const before = await poll("metric findings", async () => {
    const snapshot = await request<InvestigationResponseV1>("GET", `/v1/alerts/${alert.id}/investigation`);
    return snapshot.findings.length ? snapshot : undefined;
  });
  const context = await request<AlertRuleEditContext>("GET", `/v1/alert-rules/${original.id}/edit-context`);
  const payload = { name: `${marker}-replacement`, config: { ...config, threshold: 200 }, revisionToken: context.revisionToken };
  const replacement = await request<AlertRuleReplacement>("POST", `/v1/alert-rules/${original.id}/replacements`, payload, 201);
  owned.set(replacement.replacement.id, payload.name);
  assert.equal(replacement.previousRuleId, original.id);
  assert.notEqual(replacement.replacement.id, original.id);
  assert.equal(replacement.replacement.enabled, false);
  const savedOriginal = await request<AlertRule>("GET", `/v1/alert-rules/${original.id}`);
  assert.equal(savedOriginal.enabled, false);
  assert.equal(savedOriginal.name, original.name);
  assert.deepEqual(savedOriginal.config, original.config);
  assert.deepEqual(await alertRows(original.id), [alert]);
  const after = await request<InvestigationResponseV1>("GET", `/v1/alerts/${alert.id}/investigation`);
  assert.deepEqual(after.findings, before.findings);
  await request("POST", `/v1/alert-rules/${original.id}/replacements`, payload, 409);

  const raceOriginal = await create("race");
  const raceContext = await repository.editContext(raceOriginal.id);
  const race = await Promise.all(["one", "two"].map(async (suffix) => {
    const name = `${marker}-race-${suffix}`;
    const response = await app.inject({ method: "POST", url: `/v1/alert-rules/${raceOriginal.id}/replacements`,
      payload: { name, config, revisionToken: raceContext.revisionToken } });
    if (response.statusCode === 201) owned.set(response.json<AlertRuleReplacement>().replacement.id, name);
    return response.statusCode;
  }));
  assert.deepEqual(race.sort(), [201, 409]);

  const rollbackOriginal = await create("rollback");
  await request("PATCH", `/v1/alert-rules/${rollbackOriginal.id}`, { enabled: true });
  const rollbackContext = await repository.editContext(rollbackOriginal.id);
  const failingPool = {
    query: postgres.query.bind(postgres),
    connect: async () => {
      const client = await postgres.connect();
      return new Proxy(client, { get(target, key) {
        if (key === "query") return (...args: unknown[]) => {
          if (typeof args[0] === "string" && /^\s*INSERT INTO alert_rules/i.test(args[0])) return Promise.reject(new Error("controlled insert failure"));
          return Reflect.apply(target.query, target, args);
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    },
  } as Pick<Pool, "query" | "connect">;
  await assert.rejects(new AlertRuleRepository(failingPool).replace(rollbackOriginal.id,
    { name: `${marker}-never-inserted`, config }, rollbackContext.revisionToken), /controlled insert failure/);
  assert.deepEqual(await repository.editContext(rollbackOriginal.id), rollbackContext);
  await waitForAcknowledgements();
  result = { event: "alert_rule_management_verified", runId, gaugeValues: [50, 120],
    threshold: 100, replacementThreshold: 200, originalAlertAndFindingsPreserved: true,
    concurrentStatuses: race, realDatabaseRollback: true, providerCalls: 0,
    acknowledgedDisposableMessages: published.size,
    retainedTelemetry: { service, metricName }, publicListenerStarted: false };
}

try {
  await verify();
} catch (error) {
  process.exitCode = 1;
  // Never print connection credentials, query data, or raw HTTP responses.
  console.error(JSON.stringify({ event: "alert_rule_verification_failed", runId,
    stage: owned.size ? "verification" : "preflight", checkpoint,
    errorType: error instanceof Error ? error.name : "UnknownError" }));
} finally {
  // Pause our rules first, then wait for our already-published messages to ACK.
  // Never delete a rule while its in-flight evaluation may still reference it.
  let safeToDelete = true;
  try {
    for (const [id, name] of owned) {
      const rule = await repository.findById(id);
      if (!rule) continue;
      assert.equal(rule.name, name);
      assert.equal((rule.config as MetricThresholdRuleConfig).service, service);
      assert.equal((rule.config as MetricThresholdRuleConfig).metricName, metricName);
      if (rule.enabled) await request("PATCH", `/v1/alert-rules/${id}`, { enabled: false });
    }
    await waitForAcknowledgements();
  } catch {
    safeToDelete = false;
    cleanupFailed = true;
    process.exitCode = 1;
    console.error(JSON.stringify({ event: "alert_rule_verification_cleanup_deferred", runId, ruleIds: [...owned.keys()] }));
  }
  for (const [id, name] of owned) {
    if (!safeToDelete) break;
    try {
      const rule = await repository.findById(id);
      if (!rule) continue;
      assert.equal(rule.name, name, "Refusing cleanup: rule ownership changed");
      assert.equal(rule.type, "metric_threshold");
      assert.equal((rule.config as MetricThresholdRuleConfig).service, service);
      assert.equal((rule.config as MetricThresholdRuleConfig).metricName, metricName);
      await request("DELETE", `/v1/alert-rules/${id}`, undefined, 204);
      cleaned += 1;
    } catch {
      cleanupFailed = true;
      process.exitCode = 1;
      console.error(JSON.stringify({ event: "alert_rule_verification_cleanup_failed", runId, ruleId: id }));
    }
  }
  await Promise.allSettled([app.close(), postgres.end(), clickhouse.close(), redis.isOpen ? redis.quit() : Promise.resolve()]);
  if (result && !cleanupFailed) console.log(JSON.stringify({ ...result, cleanedDisposableRules: cleaned }));
}
