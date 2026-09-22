import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({ root: process.cwd(), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
test.after(() => vite.close());
const { RuleRequestError, RULE_REQUEST_TIMEOUT_MS } = await vite.ssrLoadModule("/src/data/alertRuleDataSource.ts");
const { HttpMetricDiscoveryDataSource, parseServiceDiscoveryResult, parseMetricDiscoveryResult } =
  await vite.ssrLoadModule("/src/data/metricDiscoveryDataSource.ts");

const applicationId = "00000000-0000-4000-8000-000000000001";
const window = { from: "2026-09-12T10:00:00.000Z", to: "2026-09-13T10:00:00.000Z" };
const service = "checkout-service";
const metric = { name: "checkout.queue.depth", types: ["gauge"], units: ["items"],
  lastSeen: "2026-09-13T09:59:59.123Z", metadataTruncated: false };
const services = { data: [service, "payment-service"], hasMore: false, window };
const metrics = { service, data: [metric], hasMore: false, window };
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
const hasKind = (kind) => (error) => error instanceof RuleRequestError && error.kind === kind;
const fetched = (reply) => {
  const calls = [];
  const fetchFn = async (...args) => { calls.push(args); return typeof reply === "function" ? reply(...args) : reply; };
  return { calls, source: new HttpMetricDiscoveryDataSource("http://localhost:3000///", fetchFn) };
};

test("service discovery preserves names, caps the request and remains read-only", async () => {
  const exact = { ...services, data: [" checkout-service ", "Checkout-Service", "checkout-service"] };
  const { source, calls } = fetched(response(exact));
  const controller = new AbortController();
  assert.deepEqual(await source.services(applicationId, controller.signal), exact);
  const url = new URL(calls[0][0]);
  assert.equal(url.pathname, "/v1/metrics/discovery/services");
  assert.equal(url.searchParams.get("applicationId"), applicationId);
  assert.equal(url.searchParams.get("limit"), "200");
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].headers.Accept, "application/json");
  assert.equal(calls[0][1].body, undefined);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.equal(calls[0][1].signal.aborted, false);
  assert.equal(calls.length, 1);
});

test("metric discovery encodes the exact service and preserves metric metadata", async () => {
  const exactService = " Checkout / pay?&+# 東京 ";
  const exactMetric = { ...metric, name: " CPUUsage / Queue Depth ", types: ["gauge", "Gauge", " counter "], units: ["", "items", " Items "] };
  const payload = { ...metrics, service: exactService, data: [exactMetric], hasMore: true };
  const { source, calls } = fetched(response(payload));
  assert.deepEqual(await source.metrics(applicationId, exactService), payload);
  const url = new URL(calls[0][0]);
  assert.equal(url.pathname, "/v1/metrics/discovery/metrics");
  assert.equal(url.searchParams.get("service"), exactService);
  assert.equal(url.searchParams.get("applicationId"), applicationId);
  assert.equal(url.searchParams.get("limit"), "200");
  assert.equal([...url.searchParams.keys()].length, 3);
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].body, undefined);
  assert.equal(calls.length, 1);
});

test("empty discovery is valid and hasMore is not inferred from result length", () => {
  for (const hasMore of [false, true]) {
    const emptyServices = { data: [], hasMore, window };
    const emptyMetrics = { service, data: [], hasMore, window };
    assert.deepEqual(parseServiceDiscoveryResult(emptyServices), emptyServices);
    assert.deepEqual(parseMetricDiscoveryResult(emptyMetrics, service), emptyMetrics);
  }
});

test("mixed types, missing-unit markers and truncated metadata remain explicit", () => {
  const descriptor = { ...metric, types: ["gauge", "counter"], units: ["", "items"], metadataTruncated: true };
  const payload = { ...metrics, data: [descriptor], hasMore: true };
  assert.deepEqual(parseMetricDiscoveryResult(payload, service), payload);
});

test("discovery supports 200 unique identities and 512-character names", () => {
  const servicePayload = { ...services, data: Array.from({ length: 200 }, (_, index) => `service-${index}`), hasMore: true };
  assert.deepEqual(parseServiceDiscoveryResult(servicePayload), servicePayload);
  const metricPayload = { ...metrics, data: Array.from({ length: 200 }, (_, index) => ({ ...metric, name: `metric-${index}` })), hasMore: true };
  assert.deepEqual(parseMetricDiscoveryResult(metricPayload, service), metricPayload);
  const long = "x".repeat(512);
  assert.equal(parseServiceDiscoveryResult({ ...services, data: [long] }).data[0], long);
  assert.equal(parseMetricDiscoveryResult({ ...metrics, service: long, data: [{ ...metric, name: long }] }, long).data[0].name, long);
});

test("service envelope rejects malformed, unbounded and duplicate identities", () => {
  for (const payload of [null, [], "services", {}, { ...services, data: null }, { ...services, hasMore: "false" },
    { ...services, data: Array.from({ length: 201 }, (_, index) => `service-${index}`) },
    ...["", " ", null, 123, "x".repeat(513)].map((name) => ({ ...services, data: [name] })),
    { ...services, data: [service, service] }]) {
    assert.throws(() => parseServiceDiscoveryResult(payload), hasKind("invalid_response"));
  }
});

test("metric envelope requires an exact echoed service and bounded unique names", () => {
  for (const payload of [null, [], {}, { ...metrics, service: undefined }, { ...metrics, service: "Checkout-Service" },
    { ...metrics, service: ` ${service} ` }, { ...metrics, data: null }, { ...metrics, hasMore: 0 },
    { ...metrics, data: Array.from({ length: 201 }, (_, index) => ({ ...metric, name: `metric-${index}` })) },
    { ...metrics, data: [metric, metric] }]) {
    assert.throws(() => parseMetricDiscoveryResult(payload, service), hasKind("invalid_response"));
  }
});

test("metric descriptor rejects wrong field types and missing metadata", () => {
  for (const descriptor of [null, [], "metric", {}, ...["", " ", 123, "x".repeat(513)].map((name) => ({ ...metric, name })),
    { ...metric, metadataTruncated: "false" }, { ...metric, metadataTruncated: undefined },
    { ...metric, lastSeen: undefined }, { ...metric, types: undefined }, { ...metric, units: undefined }]) {
    assert.throws(() => parseMetricDiscoveryResult({ ...metrics, data: [descriptor] }, service), hasKind("invalid_response"));
  }
});

test("metadata arrays reject duplicates, non-strings, empty lists and over 20 entries", () => {
  for (const field of ["types", "units"]) {
    for (const value of [null, "gauge", [], [null], [123], ["gauge", "gauge"], ["x".repeat(513)],
      Array.from({ length: 21 }, (_, index) => `metadata-${index}`)]) {
      assert.throws(() => parseMetricDiscoveryResult({ ...metrics, data: [{ ...metric, [field]: value }] }, service), hasKind("invalid_response"));
    }
  }
  for (const types of [[""], [" "]]) {
    assert.throws(() => parseMetricDiscoveryResult({ ...metrics, data: [{ ...metric, types }] }, service), hasKind("invalid_response"));
  }
  const descriptor = { ...metric, types: Array.from({ length: 20 }, (_, index) => `type-${index}`),
    units: Array.from({ length: 20 }, (_, index) => index ? `unit-${index}` : ""), metadataTruncated: true };
  assert.deepEqual(parseMetricDiscoveryResult({ ...metrics, data: [descriptor] }, service).data[0], descriptor);
});

test("window timestamps must be finite valid UTC ISO dates with real calendar components", () => {
  for (const value of [null, [], undefined, {}, { ...window, from: "not-a-date" }, { ...window, to: 0 },
    { ...window, from: "2026-02-30T10:00:00.000Z" }, { ...window, to: "2026-09-13T24:00:00.000Z" },
    { ...window, from: "2026-09-12" }, { ...window, to: "2026-09-13 10:00:00Z" },
    { ...window, to: "2026-09-13T10:00:00" }]) {
    assert.throws(() => parseServiceDiscoveryResult({ ...services, window: value }), hasKind("invalid_response"));
    assert.throws(() => parseMetricDiscoveryResult({ ...metrics, window: value }, service), hasKind("invalid_response"));
  }
});

test("window must be ordered and bounded to recent 24 hours without exact equality", () => {
  for (const value of [{ from: window.to, to: window.from }, { from: window.to, to: window.to },
    { ...window, from: "2026-09-11T10:00:00.000Z" }]) {
    assert.throws(() => parseServiceDiscoveryResult({ ...services, window: value }), hasKind("invalid_response"));
  }
  const imprecise = { ...window, from: "2026-09-12T09:59:59.999Z" };
  assert.deepEqual(parseServiceDiscoveryResult({ ...services, window: imprecise }).window, imprecise);
  const shorter = { from: "2026-09-13T09:00:00Z", to: "2026-09-13T10:00:00Z" };
  assert.deepEqual(parseMetricDiscoveryResult({ ...metrics, window: shorter }, service).window, shorter);
});

test("lastSeen must be finite, valid and inside the echoed discovery window", () => {
  for (const lastSeen of [null, "not-a-date", "2026-02-30T10:00:00.000Z", "2026-09-12T09:59:59.999Z", "2026-09-13T10:00:00.001Z"]) {
    assert.throws(() => parseMetricDiscoveryResult({ ...metrics, data: [{ ...metric, lastSeen }] }, service), hasKind("invalid_response"));
  }
  for (const lastSeen of [window.from, window.to]) {
    assert.equal(parseMetricDiscoveryResult({ ...metrics, data: [{ ...metric, lastSeen }] }, service).data[0].lastSeen, lastSeen);
  }
});

test("local invalid services never dispatch and valid long names are not trimmed", async () => {
  const { source, calls } = fetched(response({ ...metrics, service: "x".repeat(512) }));
  for (const value of [undefined, null, 123, "", " ", "x".repeat(513)]) {
    assert.throws(() => source.metrics(applicationId, value), hasKind("validation"));
  }
  assert.equal(calls.length, 0);
  await source.metrics(applicationId, "x".repeat(512));
  assert.equal(calls.length, 1);
});

for (const method of ["services", "metrics"]) {
  const invoke = (source, signal) => method === "services" ? source.services(applicationId, signal) : source.metrics(applicationId, service, signal);

  test(`${method} HTTP errors are safe and never retried`, async () => {
    for (const [status, kind] of [[400, "validation"], [422, "validation"], [404, "not_found"], [409, "conflict"], [503, "unavailable"]]) {
      const { source, calls } = fetched(response({ message: "private-server-details" }, status));
      await assert.rejects(invoke(source), (error) => hasKind(kind)(error) && error.status === status && !error.message.includes("private-server-details"));
      assert.equal(calls.length, 1);
    }
  });

  test(`${method} network and malformed JSON errors remain distinct without retries`, async () => {
    for (const [reply, kind] of [[() => { throw new Error("private-network-details"); }, "unavailable"],
      [new Response("not-json"), "invalid_response"], [response({}), "invalid_response"]]) {
      const { source, calls } = fetched(reply);
      await assert.rejects(invoke(source), (error) => hasKind(kind)(error) && !error.message.includes("private-network-details"));
      assert.equal(calls.length, 1);
    }
  });

  test(`${method} pre-aborted requests do not dispatch`, async () => {
    const controller = new AbortController();
    controller.abort();
    const { source, calls } = fetched(response(method === "services" ? services : metrics));
    await assert.rejects(invoke(source, controller.signal), hasKind("aborted"));
    assert.equal(calls.length, 0);
  });

  test(`${method} cancellation settles even when the transport ignores AbortSignal`, async () => {
    const controller = new AbortController();
    const { source, calls } = fetched(() => new Promise(() => {}));
    const rejected = assert.rejects(invoke(source, controller.signal), hasKind("aborted"));
    controller.abort();
    await rejected;
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].signal.aborted, true);
  });

  test(`${method} cancellation also bounds an ignoring JSON body`, async () => {
    const controller = new AbortController();
    let bodyStarted;
    const started = new Promise((resolve) => { bodyStarted = resolve; });
    const { source, calls } = fetched({ ok: true, status: 200, json: () => { bodyStarted(); return new Promise(() => {}); } });
    const rejected = assert.rejects(invoke(source, controller.signal), hasKind("aborted"));
    await started;
    controller.abort();
    await rejected;
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].signal.aborted, true);
  });

  test(`${method} timeout bounds an ignoring transport to the shared 15 seconds`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const { source, calls } = fetched(() => new Promise(() => {}));
    const rejected = assert.rejects(invoke(source), hasKind("unavailable"));
    context.mock.timers.tick(RULE_REQUEST_TIMEOUT_MS);
    await rejected;
    assert.equal(RULE_REQUEST_TIMEOUT_MS, 15_000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].signal.aborted, true);
  });

  test(`${method} timeout also bounds a successful but stalled JSON body`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let bodyStarted;
    const started = new Promise((resolve) => { bodyStarted = resolve; });
    const { source, calls } = fetched({ ok: true, status: 200, json: () => { bodyStarted(); return new Promise(() => {}); } });
    const rejected = assert.rejects(invoke(source), hasKind("unavailable"));
    await started;
    context.mock.timers.tick(RULE_REQUEST_TIMEOUT_MS);
    await rejected;
    assert.equal(calls.length, 1);
  });

  test(`${method} confirmed reads remove the caller listener and timeout`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const controller = new AbortController();
    const { source, calls } = fetched(response(method === "services" ? services : metrics));
    await invoke(source, controller.signal);
    controller.abort();
    context.mock.timers.tick(RULE_REQUEST_TIMEOUT_MS);
    assert.equal(calls[0][1].signal.aborted, false);
    assert.equal(calls.length, 1);
  });
}

test("default fetch wrapper resolves the current global transport", async (context) => {
  const calls = [];
  context.mock.method(globalThis, "fetch", async (...args) => { calls.push(args); return response(services); });
  const source = new HttpMetricDiscoveryDataSource("http://localhost:3000/");
  assert.deepEqual(await source.services(applicationId), services);
  assert.equal(calls.length, 1);
});
