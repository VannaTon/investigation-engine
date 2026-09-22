import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { postgres } from "../config/postgres.js";
import { AlertRepository } from "../repository/alert.repository.js";
import { AlertInvestigationRepository } from "../repository/alert-investigation.repository.js";
import { AlertService } from "../services/alert.service.js";
import { AlertInvestigationService } from "../services/alert-investigation.service.js";
import { createAlertLifecycleTransaction } from "../services/alert-lifecycle-transaction.js";

// Opt-in: creates only a uniquely named schema, never rows in application tables.
test("real PostgreSQL lifecycle transactions and races", {
  skip: process.env.TEST_ALERT_LIFECYCLE_POSTGRES !== "true",
  timeout: 120000,
}, async (t) => {
  const schema = "lifecycle_test_" + randomUUID().replaceAll("-", "");
  const pool = new Pool({
    ...postgres.options,
    // pg makes this property non-enumerable, so object spread omits it.
    password: postgres.options.password,
    options: `-c search_path=${schema} -c statement_timeout=30000`,
    application_name: schema,
    connectionTimeoutMillis: 5000,
    max: 4,
  });
  const transaction = createAlertLifecycleTransaction(pool);
  const alerts = new AlertRepository();
  const investigations = new AlertInvestigationRepository();
  const unused = undefined as never;
  const finalizer = new AlertInvestigationService(
    unused, unused, unused, investigations, unused, unused, unused, unused,
    unused, unused, unused, unused, unused, unused, unused,
  );
  const service = new AlertService(alerts, investigations, finalizer, transaction);
  let created = false;
  try {
    await postgres.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    t.diagnostic("Disposable schema created; creating test tables.");
    await pool.query(`CREATE TABLE alerts (
      id uuid PRIMARY KEY, rule_id uuid, application_id uuid NOT NULL,
      status text NOT NULL, title text, message text,
      fingerprint text, service text, trace_id text, started_at timestamptz,
      acknowledged_at timestamptz, resolved_at timestamptz,
      created_at timestamptz DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE alert_investigations (
      id uuid PRIMARY KEY, alert_id uuid REFERENCES alerts(id), default_window_from timestamptz,
      default_window_to timestamptz, window_from timestamptz, window_to timestamptz,
      edited_at timestamptz, finalized_at timestamptz,
      created_at timestamptz DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
    )`);
    t.diagnostic("Disposable tables ready; exercising the real lifecycle path.");
    async function seed(withInvestigation = true) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO alerts (id, rule_id, application_id, status, title, message, started_at) VALUES ($1, $2, $3, 'firing', 'test', 'test', CURRENT_TIMESTAMP)",
        [id, randomUUID(), randomUUID()],
      );
      if (withInvestigation) await pool.query("INSERT INTO alert_investigations (id, alert_id, default_window_from) VALUES ($1, $2, CURRENT_TIMESTAMP)", [randomUUID(), id]);
      return id;
    }
    async function snapshot(id: string) {
      return {
        alert: (await pool.query("SELECT * FROM alerts WHERE id=$1", [id])).rows[0],
        investigation: (await pool.query("SELECT * FROM alert_investigations WHERE alert_id=$1", [id])).rows[0],
      };
    }
    await t.test("acknowledgement is stable; backwards transitions conflict; resolution retries preserve all timestamps", async () => {
      const id = await seed();
      await service.updateStatus(id, "firing");
      await service.updateStatus(id, "acknowledged");
      const acknowledged = await snapshot(id);
      await service.updateStatus(id, "acknowledged");
      assert.deepEqual(await snapshot(id), acknowledged);
      await assert.rejects(service.updateStatus(id, "firing"), { statusCode: 409 });
      await service.updateStatus(id, "resolved");
      const resolved = await snapshot(id);
      assert.equal(resolved.alert.status, "resolved");
      assert.ok(resolved.investigation.finalized_at);
      assert.equal(resolved.investigation.window_to.getTime() - resolved.alert.resolved_at.getTime(), 5 * 60000);
      await service.resolve(id, 12);
      assert.deepEqual(await snapshot(id), resolved);
      await assert.rejects(service.updateStatus(id, "acknowledged"), { statusCode: 409 });
      await assert.rejects(service.updateStatus(id, "firing"), { statusCode: 409 });
      await assert.rejects(service.updateStatus(id, "bogus" as never), { statusCode: 400 });
      await assert.rejects(service.resolve(randomUUID()), /Alert not found/);
    });
    await t.test("failed finalization rolls back both writes; retry succeeds", async () => {
      const id = await seed();
      const before = await snapshot(id);
      const failing = new AlertService(alerts, investigations, {
        async finalizeForAlert(...args) {
          await finalizer.finalizeForAlert(...args);
          throw new Error("controlled finalization failure");
        },
      }, transaction);
      await assert.rejects(failing.resolve(id), /controlled finalization failure/);
      assert.deepEqual(await snapshot(id), before);
      await service.resolve(id);
      assert.equal((await snapshot(id)).alert.status, "resolved");
      const missing = await seed(false);
      await assert.rejects(service.resolve(missing), /investigation not found/);
      assert.equal((await snapshot(missing)).alert.status, "firing");
    });
    await t.test("custom recovery duration and manually edited window are preserved", async () => {
      const id = await seed();
      const editedEnd = "2026-08-15T06:22:00.000Z";
      await pool.query("UPDATE alert_investigations SET edited_at=CURRENT_TIMESTAMP, window_to=$2 WHERE alert_id=$1", [id, editedEnd]);
      await service.resolve(id, 12);
      const result = await snapshot(id);
      assert.equal(result.investigation.window_to.toISOString(), editedEnd);
      assert.equal(result.investigation.default_window_to.getTime() - result.alert.resolved_at.getTime(), 12 * 60000);
    });
    await t.test("stale acknowledgement cannot overtake an in-flight resolution", async () => {
      const id = await seed();
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const blocked = new AlertService(alerts, investigations, {
        async finalizeForAlert(...args) {
          enter();
          await gate;
          return finalizer.finalizeForAlert(...args);
        },
      }, transaction);
      const resolving = blocked.resolve(id);
      await entered;
      const acknowledging = assert.rejects(service.updateStatus(id, "acknowledged"), { statusCode: 409 });
      release();
      await Promise.all([resolving, acknowledging]);
      const result = await snapshot(id);
      assert.equal(result.alert.status, "resolved");
      assert.equal(result.alert.acknowledged_at, null);
      assert.ok(result.investigation.finalized_at);
    });
    await t.test("concurrent manual and recovery resolution share one stable result", async () => {
      const id = await seed();
      await Promise.all([service.updateStatus(id, "resolved"), service.resolve(id, 12), service.resolve(id, 12)]);
      const result = await snapshot(id);
      const duration = result.investigation.default_window_to.getTime() - result.alert.resolved_at.getTime();
      assert.ok(duration === 5 * 60000 || duration === 12 * 60000);
      await service.resolve(id);
      assert.deepEqual(await snapshot(id), result);
    });
    await t.test("legacy partial resolution can finish without moving its resolution timestamp", async () => {
      const id = await seed();
      await pool.query("UPDATE alerts SET status='resolved', resolved_at=CURRENT_TIMESTAMP WHERE id=$1", [id]);
      const before = await snapshot(id);
      await service.resolve(id);
      const after = await snapshot(id);
      assert.deepEqual(after.alert, before.alert);
      assert.ok(after.investigation.finalized_at);
    });
    await t.test("window edits cannot overwrite finalized boundaries", async () => {
      const id = await seed();
      await service.resolve(id);
      const before = await snapshot(id);
      await assert.rejects(transaction((client) => investigations.updateWindow(
        before.investigation.id, "2026-08-15T05:00:00Z", "2026-08-15T06:00:00Z", client,
      )));
      assert.deepEqual(await snapshot(id), before);
    });
  } finally {
    await pool.end();
    if (created) {
      await postgres.query(`DROP SCHEMA "${schema}" CASCADE`);
      t.diagnostic("Disposable schema and all test rows removed.");
    }
    await postgres.end();
  }
});
