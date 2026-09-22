import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { NotFoundError } from "../error/not-found.error.js";
import { AlertRuleRepository } from "../repository/alert-rule.repository.js";
import { AlertRuleInputError, alertRuleRevisionToken } from "../services/alert-rule-input.js";
import { AlertRuleService } from "../services/alert-rule.service.js";
import type { AlertRule, MetricRuleInput, MetricThresholdRuleConfig } from "../types/alert.js";

const id = "24afd0ec-1843-488c-9577-8b897eafd0c1";
const replacementId = "24afd0ec-1843-488c-9577-8b897eafd0c2";
const applicationId = "00000000-0000-4000-8000-000000000001";
const config: MetricThresholdRuleConfig = {
  service: "checkout-service", metricName: "checkout.queue.depth", operator: ">",
  threshold: 100, windowMinutes: 5, recoveryWindowMinutes: 3, stalenessMinutes: 1,
};
const rule: AlertRule = {
  id, applicationId, name: "Checkout queue too long", type: "metric_threshold", enabled: true,
  config, createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z",
};
const initialEpoch = "1789257600.123456";
const nextEpoch = "1789257600.123457";
const input: MetricRuleInput = { name: "Queue replacement", config: { ...config, threshold: 80 } };
type Row = { id: string; application_id: string; name: string; type: AlertRule["type"]; enabled: boolean;
  config: AlertRule["config"]; created_at: string; updated_at: string; revision_epoch: string };
function asRow(value: AlertRule = rule, epoch = initialEpoch): Row {
  return { id: value.id, application_id: value.applicationId, name: value.name, type: value.type, enabled: value.enabled,
    config: structuredClone(value.config), created_at: value.createdAt,
    updated_at: value.updatedAt, revision_epoch: epoch };
}
function result(rows: Row[]) { return { rows, rowCount: rows.length }; }

// This fake models only the transaction and row-lock paths under test. It does
// not assert PostgreSQL behavior; the real integration test remains separately opt-in.
function fakePool(options: { missing?: boolean; type?: AlertRule["type"];
  enabled?: boolean; failure?: "insert" | "commit" | "rollback" } = {}) {
  let row = asRow({ ...rule, ...(options.type ? { type: options.type } : {}),
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}) });
  const created: Row[] = [];
  const calls: { sql: string; values: unknown[]; connection: number }[] = [];
  const released: { connection: number; discarded: boolean }[] = [];
  let connectionCounter = 0;
  let locked = false;
  const waiting: (() => void)[] = [];
  async function lock(): Promise<void> {
    if (locked) await new Promise<void>((resolve) => waiting.push(resolve));
    else locked = true;
  }
  function unlock(): void {
    const next = waiting.shift(); if (next) next(); else locked = false;
  }
  function queryLog(sql: string, values: unknown[] = [], connection = 0) {
    const compact = sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: compact, values: [...values], connection });
    return compact;
  }
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      queryLog(sql, values);
      return result(options.missing ? [] : [structuredClone(row)]);
    },
    async connect() {
      const connection = ++connectionCounter;
      let ownsLock = false;
      let snapshot: Row | undefined;
      let createdCount = 0;
      return {
        async query(sql: string, values: unknown[] = []) {
          const compact = queryLog(sql, values, connection);
          if (compact === "BEGIN") return result([]);
          if (compact === "COMMIT") {
            if (options.failure === "commit") throw new Error("COMMIT failed");
            if (ownsLock) { ownsLock = false; unlock(); }
            return result([]);
          }
          if (compact === "ROLLBACK") {
            if (options.failure === "rollback") throw new Error("ROLLBACK failed");
            if (snapshot) row = snapshot;
            created.splice(createdCount);
            if (ownsLock) { ownsLock = false; unlock(); }
            return result([]);
          }
          if (/^SELECT/i.test(compact)) {
            assert.match(compact, /FOR UPDATE/i, "Replacement must lock its original rule before checking revision");
            await lock(); ownsLock = true;
            snapshot = structuredClone(row); createdCount = created.length;
            return result(options.missing ? [] : [structuredClone(row)]);
          }
          if (/^UPDATE alert_rules/i.test(compact)) {
            assert.ok(ownsLock);
            row = { ...row, enabled: false, revision_epoch: nextEpoch,
              updated_at: "2026-09-13T00:00:00.001Z" };
            return result([structuredClone(row)]);
          }
          if (/^INSERT INTO alert_rules/i.test(compact)) {
            assert.ok(ownsLock);
            if (options.failure === "insert" || options.failure === "rollback") throw new Error("INSERT failed");
            const serializedConfig = values.find((value) => typeof value === "string" && value.startsWith("{"));
            assert.equal(typeof serializedConfig, "string");
            const replacement = asRow({ ...rule, id: replacementId,
              applicationId: values[0] as string, name: values[1] as string,
              config: JSON.parse(serializedConfig as string) as MetricThresholdRuleConfig,
              enabled: false }, nextEpoch);
            assert.ok(values.includes(false), "Replacement INSERT must explicitly set enabled=false");
            created.push(replacement);
            return result([structuredClone(replacement)]);
          }
          throw new Error(`Unexpected SQL: ${compact}`);
        },
        release(error?: Error) {
          released.push({ connection, discarded: Boolean(error) });
          // Discarding a rollback-failed connection also releases its simulated lock.
          if (ownsLock) { ownsLock = false; unlock(); }
        },
      } as unknown as PoolClient;
    },
  } as unknown as Pick<Pool, "query" | "connect">;
  return { pool, calls, released, created, current: () => structuredClone(row) };
}

test("revision tokens retain exact database precision and canonical config order", () => {
  const first = alertRuleRevisionToken(rule, initialEpoch);
  assert.match(first, /^[a-f0-9]{64}$/);
  const sameDateDifferentMicrosecond = alertRuleRevisionToken(rule, nextEpoch);
  assert.notEqual(first, sameDateDifferentMicrosecond);
  const reorderedConfig = Object.fromEntries(Object.entries(config).reverse()) as MetricThresholdRuleConfig;
  assert.equal(first, alertRuleRevisionToken({ ...rule, config: reorderedConfig }, initialEpoch));
  for (const changed of [{ ...rule, enabled: false }, { ...rule, name: "Other" },
    { ...rule, config: { ...config, threshold: 90 } }]) {
    assert.notEqual(first, alertRuleRevisionToken(changed, initialEpoch));
  }
});

test("edit context uses the exact PostgreSQL epoch rather than lossy public dates", async () => {
  const fixture = fakePool();
  const repository = new AlertRuleRepository(fixture.pool);
  const context = await repository.editContext(id);
  assert.deepEqual(context.rule, rule);
  assert.equal(context.revisionToken, alertRuleRevisionToken(rule, initialEpoch));
  assert.match(fixture.calls[0]!.sql, /EXTRACT\(EPOCH FROM updated_at\)::text AS revision_epoch/i);
  assert.deepEqual(fixture.calls[0]!.values, [id]);
  assert.equal(fixture.released.length, 0, "A read-only context does not open a transaction");
});

test("replacement locks, disables only the old rule, inserts a disabled new rule, and commits", async () => {
  const fixture = fakePool();
  const repository = new AlertRuleRepository(fixture.pool);
  const context = await repository.editContext(id);
  const replacement = await repository.replace(id, input, context.revisionToken);
  assert.deepEqual(replacement, { previousRuleId: id, replacement: {
    ...rule, id: replacementId, name: input.name, config: input.config, enabled: false,
  } });
  const old = fixture.current();
  assert.equal(old.name, rule.name);
  assert.deepEqual(old.config, config);
  assert.equal(old.enabled, false);
  assert.equal(fixture.created.length, 1);
  const transactionCalls = fixture.calls.filter((call) => call.connection > 0);
  assert.equal(transactionCalls[0]!.sql, "BEGIN");
  assert.match(transactionCalls[1]!.sql, /FOR UPDATE/);
  assert.match(transactionCalls[2]!.sql, /^UPDATE alert_rules/);
  assert.match(transactionCalls[2]!.sql, /GREATEST\(clock_timestamp\(\),\s*updated_at\s*\+\s*INTERVAL '1 microsecond'\)/i);
  assert.doesNotMatch(transactionCalls[2]!.sql, /\b(?:config|name)\s*=/i);
  assert.match(transactionCalls[3]!.sql, /^INSERT INTO alert_rules/);
  assert.equal(transactionCalls[4]!.sql, "COMMIT");
  assert.ok(transactionCalls.every((call) => call.connection === 1));
  assert.deepEqual(fixture.released, [{ connection: 1, discarded: false }]);
  assert.ok(fixture.calls.every((call) => !/\b(?:UPDATE|DELETE|INSERT INTO)\s+(?:alerts|investigations)\b/i.test(call.sql)),
    "Replacement must not mutate linked alerts or investigations");
});

test("missing rule and non-metric editing fail without creating a replacement", async () => {
  const missing = fakePool({ missing: true });
  const missingRepository = new AlertRuleRepository(missing.pool);
  await assert.rejects(() => missingRepository.editContext(id), NotFoundError);
  await assert.rejects(() => missingRepository.replace(id, input, "a".repeat(64)), NotFoundError);
  assert.equal(missing.created.length, 0);
  assert.ok(missing.calls.some((call) => call.sql === "ROLLBACK"));
  const legacy = fakePool({ type: "error_group" });
  const legacyRepository = new AlertRuleRepository(legacy.pool);
  await assert.rejects(() => legacyRepository.editContext(id), (error: unknown) =>
    error instanceof AlertRuleInputError && error.statusCode === 400);
  await assert.rejects(() => legacyRepository.replace(id, input, "a".repeat(64)), (error: unknown) =>
    error instanceof AlertRuleInputError && error.statusCode === 400);
  assert.equal(legacy.created.length, 0);
});

test("stale revision rolls back before any write", async () => {
  const fixture = fakePool();
  const repository = new AlertRuleRepository(fixture.pool);
  await assert.rejects(() => repository.replace(id, input, alertRuleRevisionToken(rule, nextEpoch)),
    (error: unknown) => error instanceof AlertRuleInputError && error.statusCode === 409);
  assert.equal(fixture.current().enabled, true);
  assert.equal(fixture.created.length, 0);
  assert.ok(fixture.calls.every((call) => !/^(?:UPDATE|INSERT)/i.test(call.sql)));
  assert.deepEqual(fixture.released, [{ connection: 1, discarded: false }]);
});

test("insert/commit failures roll back disabling the original and discard only rollback-failed clients", async () => {
  for (const failure of ["insert", "commit", "rollback"] as const) {
    const fixture = fakePool({ failure });
    const repository = new AlertRuleRepository(fixture.pool);
    const context = await repository.editContext(id);
    await assert.rejects(() => repository.replace(id, input, context.revisionToken),
      failure === "commit" ? /COMMIT failed/ : /INSERT failed/);
    assert.ok(fixture.calls.some((call) => call.sql === "ROLLBACK"), failure);
    assert.deepEqual(fixture.released, [{ connection: 1, discarded: failure === "rollback" }]);
    if (failure !== "rollback") {
      assert.equal(fixture.current().enabled, true);
      assert.deepEqual(fixture.current().config, config);
      assert.equal(fixture.created.length, 0);
    }
  }
});

test("two concurrent edits with the same token create exactly one replacement", async () => {
  const fixture = fakePool();
  const repository = new AlertRuleRepository(fixture.pool);
  const context = await repository.editContext(id);
  const outcomes = await Promise.allSettled([
    repository.replace(id, input, context.revisionToken),
    repository.replace(id, { ...input, name: "Concurrent replacement" }, context.revisionToken),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof AlertRuleInputError);
  assert.equal(rejected.reason.statusCode, 409);
  assert.equal(fixture.created.length, 1);
  assert.equal(fixture.current().enabled, false);
  assert.deepEqual(fixture.current().config, config);
  assert.equal(fixture.released.length, 2);
});

test("an already-disabled original still gets a new revision so replay cannot create a second replacement", async () => {
  const fixture = fakePool({ enabled: false });
  const repository = new AlertRuleRepository(fixture.pool);
  const context = await repository.editContext(id);
  await repository.replace(id, input, context.revisionToken);
  await assert.rejects(() => repository.replace(id, input, context.revisionToken),
    (error: unknown) => error instanceof AlertRuleInputError && error.statusCode === 409);
  assert.equal(fixture.created.length, 1);
});

test("service validates creation and replacement even when called outside HTTP", async () => {
  let writes = 0;
  const storage = {
    async create() { writes++; return rule; },
    async replace() { writes++; return { previousRuleId: id, replacement: rule }; },
  } as unknown as AlertRuleRepository;
  const service = new AlertRuleService(storage);
  for (const invalid of [{ name: " ", type: "metric_threshold", config },
    { name: rule.name, type: "metric_threshold", config: { ...config, threshold: "100" } },
    { name: rule.name, type: "metric_threshold", enabled: "true", config }]) {
    await assert.rejects(() => service.create(invalid), (error: unknown) =>
      error instanceof AlertRuleInputError && error.statusCode === 400);
  }
  await assert.rejects(() => service.replace(id, input, "not-a-token"),
    (error: unknown) => error instanceof AlertRuleInputError && error.statusCode === 400);
  await assert.rejects(() => service.replace(id, { ...input, config: { ...config, stalenessMinutes: 0 } },
    alertRuleRevisionToken(rule, initialEpoch)),
    (error: unknown) => error instanceof AlertRuleInputError && error.statusCode === 400);
  assert.equal(writes, 0);
});

test("invalid legacy metric rules can be disabled but cannot be enabled without valid config", async () => {
  let writes = 0;
  const invalidRule = { ...rule, config: { ...config, windowMinutes: 0 } };
  const storage = {
    async findById() { return invalidRule; },
    async updateEnabled(ruleId: string, enabled: boolean) {
      assert.equal(ruleId, id); writes++; return { ...invalidRule, enabled };
    },
  } as unknown as AlertRuleRepository;
  const service = new AlertRuleService(storage);
  assert.equal((await service.updateEnabled(id, false)).enabled, false);
  await assert.rejects(() => service.updateEnabled(id, true),
    (error: unknown) => error instanceof AlertRuleInputError && error.statusCode === 400);
  assert.equal(writes, 1);
});
