import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { Pool, PoolClient } from "pg";
import { createAlertLifecycleTransaction } from "../services/alert-lifecycle-transaction.js";
import { AlertTransitionError } from "../error/alert-transition.error.js";
import { NotFoundError } from "../error/not-found.error.js";
import { alertRoutes } from "../routes/alert.routes.js";
import type { AlertService } from "../services/alert.service.js";
import type { AlertInvestigationService } from "../services/alert-investigation.service.js";

test("lifecycle transaction commits, rolls back, and releases its connection", async () => {
  for (const failure of ["none", "work", "commit", "rollback"]) {
    const calls: string[] = [];
    let discarded = false;
    const client = {
      async query(sql: string) {
        calls.push(sql);
        if ((failure === "commit" && sql === "COMMIT") || (failure === "rollback" && sql === "ROLLBACK")) throw new Error(sql);
      },
      release(error?: Error) { calls.push("release"); discarded = Boolean(error); },
    } as unknown as PoolClient;
    const transaction = createAlertLifecycleTransaction({ connect: async () => client } as unknown as Pool);
    const run = () => transaction(async (connection) => {
      assert.equal(connection, client);
      calls.push("work");
      if (failure === "work" || failure === "rollback") throw new Error("work failed");
      return 42;
    });
    if (failure === "none") assert.equal(await run(), 42);
    else await assert.rejects(run, failure === "commit" ? /COMMIT/ : /work failed/);
    assert.deepEqual(calls, failure === "none" ? ["BEGIN", "work", "COMMIT", "release"]
      : failure === "commit" ? ["BEGIN", "work", "COMMIT", "ROLLBACK", "release"]
      : ["BEGIN", "work", "ROLLBACK", "release"]);
    assert.equal(discarded, failure === "rollback");
  }
});

test("status route validates requests and returns lifecycle errors without changing the success shape", async () => {
  const app = Fastify();
  let calls = 0;
  let failure: Error | undefined;
  const id = "24afd0ec-1843-488c-9577-8b897eafd0c1";
  await app.register(alertRoutes, {
    alertService: { async updateStatus(alertId: string, status: string) {
      calls++;
      if (failure) throw failure;
      return { id: alertId, status };
    } } as unknown as AlertService,
    alertInvestigationService: {} as AlertInvestigationService,
  });
  try {
    for (const payload of [{}, { status: "other" }, { status: 12 }, null, { status: ["resolved"] }, { status: "resolved", extra: true }]) {
      const response = await app.inject({ method: "PATCH", url: `/v1/alerts/${id}/status`,
        headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
      assert.equal(response.statusCode, 400);
    }
    assert.equal((await app.inject({ method: "PATCH", url: "/v1/alerts/not-a-uuid/status", payload: { status: "resolved" } })).statusCode, 400);
    assert.equal(calls, 0);
    for (const status of ["firing", "acknowledged", "resolved"]) {
      const response = await app.inject({ method: "PATCH", url: `/v1/alerts/${id}/status`, payload: { status } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { id, status });
    }
    for (const [error, statusCode] of [
      [new NotFoundError("Alert not found."), 404],
      [new AlertTransitionError(409, "Alert status has changed; refresh before continuing."), 409],
      [new AlertTransitionError(400, "Unsupported alert status."), 400],
    ] as const) {
      failure = error;
      const response = await app.inject({ method: "PATCH", url: `/v1/alerts/${id}/status`, payload: { status: "acknowledged" } });
      assert.equal(response.statusCode, statusCode);
      assert.equal(response.json().message, error.message);
    }
  } finally { await app.close(); }
});
