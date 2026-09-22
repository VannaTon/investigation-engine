import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({ root: process.cwd(), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
test.after(() => vite.close());
const types = await vite.ssrLoadModule("/src/types/alertRule.ts");
const { HttpAlertRuleDataSource, RuleRequestError, parseAlertRule, RULE_REQUEST_TIMEOUT_MS } = await vite.ssrLoadModule("/src/data/alertRuleDataSource.ts");
const { HttpMetricSampleDataSource, parseMetricSampleResult } = await vite.ssrLoadModule("/src/data/metricSampleDataSource.ts");

const applicationId = "00000000-0000-4000-8000-000000000001";
const config = { service: "checkout-service", metricName: "checkout.queue.depth", operator: ">", threshold: 100,
  windowMinutes: 5, recoveryWindowMinutes: 3, stalenessMinutes: 1 };
const rule = { id: "rule-1", applicationId, name: "Checkout queue", type: "metric_threshold", enabled: false, config,
  createdAt: "2026-09-13T10:00:00.000Z", updatedAt: "2026-09-13T10:00:00.000Z" };
const input = { applicationId, name: rule.name, config };
const token = "a".repeat(64);
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
const hasKind = (kind) => (error) => error instanceof RuleRequestError && error.kind === kind;
const fetched = (reply) => {
  const calls = [];
  const fetchFn = async (...args) => { calls.push(args); return typeof reply === "function" ? reply(...args) : reply; };
  return { calls, source: new HttpAlertRuleDataSource("http://localhost:3000///", fetchFn), fetchFn };
};

test("metric config preserves exact names and accepts finite positive decimal windows", () => {
  const exact = { ...rule, config: { ...config, service: " checkout ", metricName: "queue ", threshold: -2, windowMinutes: 0.5 } };
  assert.equal(types.metricRuleConfig(exact), exact.config);
});

test("unsupported and malformed legacy configs remain readable but not editable", () => {
  for (const legacy of [{ ...rule, type: "legacy_rule" }, { ...rule, config: { service: "checkout" } },
    ...[null, [], "legacy", 10, false].map((config) => ({ ...rule, config }))]) {
    assert.deepEqual(parseAlertRule(legacy), legacy);
    assert.equal(types.metricRuleConfig(legacy), null);
  }
});

test("metric config rejects unsafe settings", () => {
  for (const invalid of [{ threshold: Infinity }, { threshold: "100" }, { service: " " }, { metricName: "" }, { operator: "=" },
    { windowMinutes: 0 }, { windowMinutes: -1 }, { recoveryWindowMinutes: NaN }, { stalenessMinutes: "1" },
    { service: "x".repeat(256) }, { metricName: "x".repeat(256) }, { windowMinutes: Number.MAX_VALUE }, { unexpected: true }]) {
    assert.equal(types.metricRuleConfig({ ...rule, config: { ...config, ...invalid } }), null);
  }
});

test("rule envelope rejects wrong primitive types, dates and missing fields", () => {
  for (const invalid of [null, [], { ...rule, id: "" }, { ...rule, enabled: "false" }, { ...rule, config: undefined },
    { ...rule, updatedAt: "not-a-date" }, { ...rule, createdAt: undefined }]) {
    assert.throws(() => parseAlertRule(invalid), hasKind("invalid_response"));
  }
});

test("list preserves legacy rows, trims base URL and forwards signal", async () => {
  const legacy = { ...rule, id: "other", type: "legacy", config: {} };
  const { source, calls } = fetched(response([rule, legacy]));
  const controller = new AbortController();
  assert.deepEqual(await source.list(controller.signal), [rule, legacy]);
  assert.equal(calls[0][0], "http://localhost:3000/v1/alert-rules");
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.equal(calls[0][1].signal.aborted, false);
  assert.equal(calls[0][1].headers.Accept, "application/json");
});

test("list rejects non-array and duplicate identifiers", async () => {
  for (const payload of [{ data: [rule] }, [rule, rule]]) await assert.rejects(fetched(response(payload)).source.list(), hasKind("invalid_response"));
});

test("get safely encodes identity and rejects mismatched response", async () => {
  const id = "rule/a?b";
  const { source, calls } = fetched(response({ ...rule, id }));
  await source.get(id);
  assert.equal(calls[0][0], "http://localhost:3000/v1/alert-rules/rule%2Fa%3Fb");
  await assert.rejects(fetched(response(rule)).source.get("other"), hasKind("invalid_response"));
});

test("edit context requires exact rule identity and lowercase SHA256 token", async () => {
  assert.deepEqual(await fetched(response({ rule, revisionToken: token })).source.editContext(rule.id), { rule, revisionToken: token });
  for (const payload of [{ rule, revisionToken: "A".repeat(64) }, { rule, revisionToken: "abc" },
    { rule: { ...rule, id: "other" }, revisionToken: token }]) {
    await assert.rejects(fetched(response(payload)).source.editContext(rule.id), hasKind("invalid_response"));
  }
});

test("create sends a disabled metric rule with exact configuration once", async () => {
  const { source, calls } = fetched(response(rule, 201));
  assert.deepEqual(await source.create(input), rule);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].method, "POST");
  assert.deepEqual(JSON.parse(calls[0][1].body), { applicationId, name: rule.name, type: "metric_threshold", enabled: false, config });
});

test("replacement includes revision token and checks both identities", async () => {
  const replacement = { ...rule, id: "rule-2" };
  const { source, calls } = fetched(response({ previousRuleId: rule.id, replacement }, 201));
  assert.deepEqual(await source.replace(rule.id, input, token), { previousRuleId: rule.id, replacement });
  assert.equal(calls[0][0], "http://localhost:3000/v1/alert-rules/rule-1/replacements");
  assert.deepEqual(JSON.parse(calls[0][1].body), { name: input.name, config: input.config, revisionToken: token });
  for (const payload of [{ previousRuleId: "wrong", replacement }, { previousRuleId: rule.id, replacement: rule },
    { previousRuleId: rule.id, replacement: { ...replacement, enabled: true } }]) {
    await assert.rejects(fetched(response(payload)).source.replace(rule.id, input, token), hasKind("uncertain"));
  }
});

test("setEnabled sends only the boolean and checks returned state", async () => {
  const { source, calls } = fetched(response({ ...rule, enabled: true }));
  await source.setEnabled(rule.id, true);
  assert.equal(calls[0][1].method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0][1].body), { enabled: true });
  await assert.rejects(fetched(response(rule)).source.setEnabled(rule.id, true), hasKind("uncertain"));
});

test("invalid local input never sends a request", () => {
  const { source, calls } = fetched(response(rule));
  assert.throws(() => source.create({ ...input, name: " " }), hasKind("validation"));
  assert.throws(() => source.create({ ...input, config: { ...config, threshold: Infinity } }), hasKind("validation"));
  assert.throws(() => source.replace(rule.id, input, "bad"), hasKind("validation"));
  assert.throws(() => source.get(" "), hasKind("validation"));
  assert.throws(() => source.setEnabled(rule.id, "true"), hasKind("validation"));
  assert.equal(calls.length, 0);
});

test("safe HTTP errors are classified without exposing server details", async () => {
  for (const [status, kind] of [[400, "validation"], [422, "validation"], [404, "not_found"], [409, "conflict"], [503, "unavailable"]]) {
    await assert.rejects(fetched(response({ message: "private-provider-details" }, status)).source.list(), (error) =>
      hasKind(kind)(error) && error.status === status && !error.message.includes("private-provider-details"));
  }
  await assert.rejects(fetched(response({}, 409)).source.replace(rule.id, input, token), hasKind("conflict"));
});

test("write transport and server failures are uncertain and not retried", async () => {
  for (const reply of [() => { throw new Error("secret-network-details"); }, response({}, 500), response({}, 503)]) {
    const { source, calls } = fetched(reply);
    await assert.rejects(source.create(input), (error) => hasKind("uncertain")(error) && !error.message.includes("secret-network-details"));
    assert.equal(calls.length, 1);
  }
});

test("malformed or mismatched successful writes are uncertain", async () => {
  for (const payload of [null, { ...rule, enabled: true }, { ...rule, name: "other" }, { ...rule, config: { ...config, threshold: 1 } }]) {
    await assert.rejects(fetched(response(payload)).source.create(input), hasKind("uncertain"));
  }
  await assert.rejects(fetched(new Response("not-json")).source.create(input), hasKind("uncertain"));
});

test("read transport and malformed JSON errors are distinct", async () => {
  await assert.rejects(fetched(() => { throw new Error("network"); }).source.list(), hasKind("unavailable"));
  await assert.rejects(fetched(new Response("not-json")).source.list(), hasKind("invalid_response"));
});

test("pre-aborted requests do not dispatch; cancellation after a write dispatch is uncertain", async () => {
  const controller = new AbortController(); controller.abort();
  const { source, calls } = fetched(response(rule));
  await assert.rejects(source.list(controller.signal), hasKind("aborted"));
  await assert.rejects(source.create(input, controller.signal), hasKind("aborted"));
  assert.equal(calls.length, 0);
  for (const write of [false, true]) {
    const running = new AbortController();
    const request = fetched(() => { running.abort(); throw new DOMException("cancelled", "AbortError"); });
    await assert.rejects(write ? request.source.create(input, running.signal) : request.source.list(running.signal), hasKind(write ? "uncertain" : "aborted"));
  }
});

for (const write of [false, true]) {
  test(`${write ? "write" : "read"} timeout bounds a transport that ignores cancellation without retrying`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const { source, calls } = fetched(() => new Promise(() => {}));
    const pending = write ? source.create(input) : source.list();
    const rejected = assert.rejects(pending, hasKind(write ? "uncertain" : "unavailable"));
    context.mock.timers.tick(RULE_REQUEST_TIMEOUT_MS);
    await rejected;
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].signal.aborted, true);
  });

  test(`${write ? "write" : "read"} timeout also bounds a stalled successful JSON body`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const { source, calls } = fetched({ ok: true, status: 200, json: () => new Promise(() => {}) });
    const pending = write ? source.create(input) : source.list();
    const rejected = assert.rejects(pending, hasKind(write ? "uncertain" : "unavailable"));
    await Promise.resolve();
    context.mock.timers.tick(RULE_REQUEST_TIMEOUT_MS);
    await rejected;
    assert.equal(calls.length, 1);
  });

  test(`${write ? "write" : "read"} caller cancellation settles an ignoring transport`, async () => {
    const controller = new AbortController();
    const { source, calls } = fetched(() => new Promise(() => {}));
    const pending = write ? source.create(input, controller.signal) : source.list(controller.signal);
    const rejected = assert.rejects(pending, hasKind(write ? "uncertain" : "aborted"));
    controller.abort();
    await rejected;
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].signal.aborted, true);
  });
}

test("confirmed requests remove their timeout and caller cancellation listener", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const { source, calls } = fetched(response([rule]));
  assert.deepEqual(await source.list(controller.signal), [rule]);
  controller.abort();
  context.mock.timers.tick(RULE_REQUEST_TIMEOUT_MS);
  assert.equal(calls[0][1].signal.aborted, false);
});

const sample = { timestamp: "2026-09-13 10:00:00.123Z", service: config.service, name: config.metricName, type: "gauge", value: 22, unit: "items" };

test("recent-sample requests share the bounded read timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { fetchFn, calls } = fetched(() => new Promise(() => {}));
  const source = new HttpMetricSampleDataSource("http://localhost:3000", fetchFn);
  const rejected = assert.rejects(source.recent(applicationId, config.service, config.metricName), hasKind("unavailable"));
  context.mock.timers.tick(RULE_REQUEST_TIMEOUT_MS);
  await rejected;
  assert.equal(calls.length, 1);
});

test("recent samples query exact names over 15 minutes with limit100 and forward cancellation", async () => {
  const { fetchFn, calls } = fetched(response({ data: [sample], hasMore: true, nextCursor: sample.timestamp }));
  const source = new HttpMetricSampleDataSource("http://localhost:3000/", fetchFn);
  const controller = new AbortController();
  const before = Date.now();
  assert.deepEqual(await source.recent(applicationId, config.service, config.metricName, controller.signal), { data: [sample], hasMore: true });
  const url = new URL(calls[0][0]);
  assert.equal(url.pathname, "/v1/metrics");
  assert.equal(url.searchParams.get("applicationId"), applicationId);
  assert.equal(url.searchParams.get("service"), config.service);
  assert.equal(url.searchParams.get("name"), config.metricName);
  assert.equal(url.searchParams.get("limit"), "100");
  const to = Date.parse(url.searchParams.get("to"));
  assert.equal(to - Date.parse(url.searchParams.get("from")), 15 * 60_000);
  assert.ok(to >= before && to <= Date.now());
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.equal(calls[0][1].signal.aborted, false);
});

test("recent samples allow empty and mixed raw metric types without aggregation", () => {
  assert.deepEqual(parseMetricSampleResult({ data: [], hasMore: false }, config.service, config.metricName), { data: [], hasMore: false });
  const counter = { ...sample, type: "counter", value: 200 };
  delete counter.unit;
  assert.deepEqual(parseMetricSampleResult({ data: [sample, counter], hasMore: false }, config.service, config.metricName), { data: [sample, counter], hasMore: false });
});

test("sample identity, values, timestamps, units and bounded envelope are validated", () => {
  for (const invalid of [{ ...sample, service: "other" }, { ...sample, name: "other" }, { ...sample, value: Infinity },
    { ...sample, value: "22" }, { ...sample, timestamp: "bad" }, { ...sample, unit: null }, { ...sample, type: "" }]) {
    assert.throws(() => parseMetricSampleResult({ data: [invalid], hasMore: false }, config.service, config.metricName), hasKind("invalid_response"));
  }
  for (const invalid of [[], { data: [], hasMore: "false" }, { data: Array.from({ length: 101 }, () => sample), hasMore: true }]) {
    assert.throws(() => parseMetricSampleResult(invalid, config.service, config.metricName), hasKind("invalid_response"));
  }
});

test("sample adapter rejects blank identity locally and reports response mismatches", async () => {
  const { fetchFn, calls } = fetched(response({ data: [{ ...sample, service: "other" }], hasMore: false }));
  const source = new HttpMetricSampleDataSource("http://localhost:3000", fetchFn);
  assert.throws(() => source.recent(applicationId, " ", config.metricName), hasKind("validation"));
  assert.equal(calls.length, 0);
  await assert.rejects(source.recent(applicationId, config.service, config.metricName), hasKind("invalid_response"));
});
