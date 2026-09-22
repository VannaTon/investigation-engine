import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { NotFoundError } from "../error/not-found.error.js";
import { alertRuleRoutes } from "../routes/alert-rule.routes.js";
import { AlertRuleInputError } from "../services/alert-rule-input.js";
import type { AlertRuleService } from "../services/alert-rule.service.js";
import type { AlertRule, MetricThresholdRuleConfig } from "../types/alert.js";

const id = "24afd0ec-1843-488c-9577-8b897eafd0c1";
const replacementId = "24afd0ec-1843-488c-9577-8b897eafd0c2";
const revisionToken = "0123456789abcdef".repeat(4);
const applicationId = "00000000-0000-4000-8000-000000000001";
const config: MetricThresholdRuleConfig = {
  service: "checkout-service", metricName: "checkout.queue.depth",
  operator: ">", threshold: 100, windowMinutes: 5,
  recoveryWindowMinutes: 3, stalenessMinutes: 1,
};
const rule: AlertRule = {
  id, applicationId, name: "Checkout queue too long", type: "metric_threshold", enabled: true,
  config, createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z",
};
type RuleServiceLike = Pick<AlertRuleService,
  "create" | "findAll" | "findById" | "updateEnabled" | "delete" | "editContext" | "replace">;
type Call = { method: string; args: unknown[] };

async function withApp(run: (app: FastifyInstance, calls: Call[],
  fail: (error: Error | undefined) => void) => Promise<void>): Promise<void> {
  const calls: Call[] = [];
  let failure: Error | undefined;
  function record(method: string, ...args: unknown[]): void {
    calls.push({ method, args });
    if (failure) throw failure;
  }
  const service: RuleServiceLike = {
    async create(input) {
      record("create", input);
      const parsed = input as { name: string; type: AlertRule["type"]; config: AlertRule["config"]; enabled?: boolean };
      return { ...rule, ...parsed, enabled: parsed.enabled ?? true };
    },
    async findAll() { record("findAll"); return [rule]; },
    async findById(ruleId) { record("findById", ruleId); return rule; },
    async updateEnabled(ruleId, enabled) { record("updateEnabled", ruleId, enabled); return { ...rule, enabled }; },
    async delete(ruleId) { record("delete", ruleId); },
    async editContext(ruleId) { record("editContext", ruleId); return { rule, revisionToken }; },
    async replace(ruleId, input, token) {
      record("replace", ruleId, input, token);
      return { previousRuleId: ruleId, replacement: {
        ...rule, id: replacementId, name: input.name, config: input.config, enabled: false,
      } };
    },
  };
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const typedError = error as Error & { validation?: unknown };
    const statusCode = error instanceof NotFoundError ? 404
      : error instanceof AlertRuleInputError ? error.statusCode
      : typedError.validation ? 400 : 500;
    return reply.code(statusCode).send({ statusCode, message: typedError.message });
  });
  await app.register(alertRuleRoutes, { alertRuleService: service });
  try { await run(app, calls, (error) => { failure = error; }); }
  finally { await app.close(); }
}

test("alert rule CRUD preserves success shapes and the existing create enabled default", async () => {
  await withApp(async (app, calls) => {
    const created = await app.inject({ method: "POST", url: "/v1/alert-rules",
      payload: { applicationId, name: rule.name, type: "metric_threshold", config } });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json(), rule);
    assert.equal((await app.inject({ method: "GET", url: "/v1/alert-rules" })).statusCode, 200);
    assert.deepEqual((await app.inject({ method: "GET", url: "/v1/alert-rules" })).json(), [rule]);
    assert.deepEqual((await app.inject({ method: "GET", url: `/v1/alert-rules/${id}` })).json(), rule);
    const disabled = await app.inject({ method: "PATCH", url: `/v1/alert-rules/${id}`, payload: { enabled: false } });
    assert.equal(disabled.statusCode, 200);
    assert.deepEqual(disabled.json(), { ...rule, enabled: false });
    const deleted = await app.inject({ method: "DELETE", url: `/v1/alert-rules/${id}` });
    assert.equal(deleted.statusCode, 204);
    assert.equal(deleted.body, "");
    assert.ok(calls.some((call) => call.method === "updateEnabled"
      && call.args[0] === id && call.args[1] === false));
  });
});

test("metric rule creation accepts zero/negative finite thresholds and preserves exact selectors", async () => {
  await withApp(async (app, calls) => {
    for (const threshold of [0, -10, 12.5]) {
      const exactConfig = { ...config, service: " Checkout Service ", metricName: "Queue.Depth", threshold };
      const response = await app.inject({ method: "POST", url: "/v1/alert-rules", payload: {
        applicationId, name: rule.name, type: "metric_threshold", enabled: false, config: exactConfig,
      } });
      assert.equal(response.statusCode, 201);
      assert.deepEqual(response.json().config, exactConfig);
      assert.equal(response.json().enabled, false);
    }
    assert.equal(calls.filter((call) => call.method === "create").length, 3);
  });
});

test("legacy error-group creation remains available outside the metric editing UI", async () => {
  await withApp(async (app) => {
    const errorConfig = { fingerprint: "example-fingerprint", threshold: 5, windowMinutes: 10 };
    const response = await app.inject({ method: "POST", url: "/v1/alert-rules", payload: {
      applicationId, name: "Repeated errors", type: "error_group", config: errorConfig,
    } });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().type, "error_group");
    assert.deepEqual(response.json().config, errorConfig);
  });
});

test("metric create rejects malformed values before coercion or unknown-field removal", async () => {
  const valid = { applicationId, name: rule.name, type: "metric_threshold", config };
  const invalid: unknown[] = [null, [], "rule", {}, { ...valid, name: "  " },
    { ...valid, name: 5 }, { ...valid, type: "other" }, { ...valid, enabled: "false" },
    { ...valid, enabled: 1 }, { ...valid, enabled: null }, { ...valid, extra: true },
    { ...valid, config: null }, { ...valid, config: [] },
    ...["service", "metricName"].flatMap((key) => ["", " ", 12].map((value) =>
      ({ ...valid, config: { ...config, [key]: value } }))),
    ...["threshold", "windowMinutes", "recoveryWindowMinutes", "stalenessMinutes"].flatMap((key) =>
      ["5", null, true, [], {}].map((value) => ({ ...valid, config: { ...config, [key]: value } }))),
    ...["windowMinutes", "recoveryWindowMinutes", "stalenessMinutes"].flatMap((key) =>
      [0, -1].map((value) => ({ ...valid, config: { ...config, [key]: value } }))),
    { ...valid, config: { ...config, operator: "=" } },
    { ...valid, config: { ...config, extra: true } },
    ...Object.keys(config).map((key) => {
      const incomplete: Record<string, unknown> = { ...config }; delete incomplete[key];
      return { ...valid, config: incomplete };
    }),
  ];
  await withApp(async (app, calls) => {
    for (const payload of invalid) {
      const response = await app.inject({ method: "POST", url: "/v1/alert-rules",
        headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
      assert.equal(response.statusCode, 400, JSON.stringify(payload));
    }
    for (const numberLiteral of ["1e999", "-1e999"]) {
      const payload = JSON.stringify(valid).replace('"threshold":100', `"threshold":${numberLiteral}`);
      assert.equal((await app.inject({ method: "POST", url: "/v1/alert-rules",
        headers: { "content-type": "application/json" }, payload })).statusCode, 400);
    }
    assert.equal(calls.length, 0);
  });
});

test("enabled PATCH accepts only an original boolean field and a UUID", async () => {
  await withApp(async (app, calls) => {
    for (const payload of [{}, null, [], { enabled: "false" }, { enabled: 0 },
      { enabled: [false] }, { enabled: null }, { enabled: false, extra: true }]) {
      assert.equal((await app.inject({ method: "PATCH", url: `/v1/alert-rules/${id}`,
        headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: "PATCH", url: "/v1/alert-rules/not-a-uuid",
      payload: { enabled: false } })).statusCode, 400);
    assert.equal(calls.length, 0);
  });
});

test("edit-context returns the original rule and revision token without changing it", async () => {
  await withApp(async (app, calls) => {
    const response = await app.inject({ method: "GET", url: `/v1/alert-rules/${id}/edit-context` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { rule, revisionToken });
    assert.match(response.json().revisionToken, /^[a-f0-9]{64}$/);
    assert.deepEqual(calls, [{ method: "editContext", args: [id] }]);
    assert.equal((await app.inject({ method: "GET", url: "/v1/alert-rules/not-a-uuid/edit-context" })).statusCode, 400);
    assert.equal(calls.length, 1);
  });
});

test("replacement returns 201 with a new disabled rule and its previous ID", async () => {
  await withApp(async (app, calls) => {
    const input = { name: "Queue replacement", config: { ...config, threshold: 80 } };
    const response = await app.inject({ method: "POST", url: `/v1/alert-rules/${id}/replacements`,
      payload: { ...input, revisionToken } });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { previousRuleId: id, replacement: {
      ...rule, id: replacementId, name: input.name, config: input.config, enabled: false,
    } });
    assert.deepEqual(calls, [{ method: "replace", args: [id, input, revisionToken] }]);
    assert.equal(rule.enabled, true);
    assert.equal(rule.config.threshold, 100);
  });
});

test("replacement requires a complete strict metric input and lower-case hex revision token", async () => {
  const valid = { name: rule.name, config, revisionToken };
  const invalid: unknown[] = [null, [], {}, { name: rule.name, config },
    { ...valid, revisionToken: revisionToken.toUpperCase() },
    { ...valid, revisionToken: "g".repeat(64) }, { ...valid, revisionToken: "a".repeat(63) },
    { ...valid, revisionToken: 5 }, { ...valid, enabled: false },
    { ...valid, type: "metric_threshold" }, { ...valid, extra: true },
    { ...valid, name: " " }, { ...valid, config: { ...config, threshold: "80" } },
    { ...valid, config: { ...config, stalenessMinutes: 0 } },
    { ...valid, config: { ...config, operator: "!=" } },
    { ...valid, config: { metricName: config.metricName } },
  ];
  await withApp(async (app, calls) => {
    for (const payload of invalid) {
      const response = await app.inject({ method: "POST", url: `/v1/alert-rules/${id}/replacements`,
        headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
      assert.equal(response.statusCode, 400, JSON.stringify(payload));
    }
    assert.equal((await app.inject({ method: "POST", url: "/v1/alert-rules/not-a-uuid/replacements",
      payload: valid })).statusCode, 400);
    assert.equal(calls.length, 0);
  });
});

test("expected rule errors remain 400/404/409 rather than generic server failures", async () => {
  await withApp(async (app, _calls, fail) => {
    for (const [error, statusCode] of [
      [new NotFoundError("Alert rule not found."), 404],
      [new AlertRuleInputError(409, "Rule changed; refresh before editing."), 409],
      [new AlertRuleInputError(400, "Only metric threshold rules can be edited."), 400],
    ] as const) {
      fail(error);
      for (const method of ["GET", "POST"] as const) {
        const response = await app.inject({ method,
          url: `/v1/alert-rules/${id}/${method === "GET" ? "edit-context" : "replacements"}`,
          ...(method === "POST" ? { payload: { name: rule.name, config, revisionToken } } : {}),
        });
        assert.equal(response.statusCode, statusCode);
        assert.equal(response.json().message, error.message);
      }
    }
    fail(new NotFoundError("Alert rule not found."));
    assert.equal((await app.inject({ method: "PATCH", url: `/v1/alert-rules/${id}`,
      payload: { enabled: false } })).statusCode, 404);
  });
});

test("unexpected rule persistence failures return a generic error without leaking internal details", async () => {
  await withApp(async (app, _calls, fail) => {
    fail(new Error("private database hostname and query details"));
    const response = await app.inject({ method: "POST", url: `/v1/alert-rules/${id}/replacements`,
      payload: { name: rule.name, config, revisionToken } });
    assert.equal(response.statusCode, 500);
    assert.doesNotMatch(response.body, /private database|hostname|query details/);
  });
});
