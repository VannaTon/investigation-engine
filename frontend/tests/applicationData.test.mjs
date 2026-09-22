import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({ root: process.cwd(), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
test.after(async () => { await vite.close(); });
const {
  APPLICATION_REQUEST_TIMEOUT_MS,
  ApplicationRequestError,
  HttpApplicationDataSource,
  parseApplication,
  parseIngestKey,
} = await vite.ssrLoadModule("/src/data/applicationDataSource.ts");
const { collectorConfiguration } = await vite.ssrLoadModule("/src/pages/ApplicationsPage.tsx");

const applicationId = "11111111-1111-4111-8111-111111111111";
const keyId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-09-20T10:00:00.000Z";
const application = { id: applicationId, name: "Checkout application", status: "active", createdAt: timestamp, updatedAt: timestamp };
const keyMetadata = { id: keyId, applicationId, name: "Production collector", prefix: "0123456789abcdef", createdAt: timestamp };
const secret = `op_ingest_0123456789abcdef_${"A".repeat(43)}`;
const response = (payload, status = 200) => new Response(payload === undefined ? null : JSON.stringify(payload), {
  status, headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
});
const hasKind = (kind) => (error) => error instanceof ApplicationRequestError && error.kind === kind;
const fetched = (reply) => {
  const calls = [];
  const fetchFn = async (...args) => { calls.push(args); return typeof reply === "function" ? reply(...args) : reply; };
  return { calls, source: new HttpApplicationDataSource("http://localhost:3000///", fetchFn) };
};

test("application and key parsers preserve trusted identity and never expose an absent secret", () => {
  assert.deepEqual(parseApplication(application), application);
  assert.deepEqual(parseIngestKey(keyMetadata, applicationId), keyMetadata);
  assert.equal("key" in parseIngestKey({ ...keyMetadata, key: secret }, applicationId), false);
  for (const value of [{ ...application, id: "bad" }, { ...application, status: "unknown" }, { ...application, createdAt: "bad" }]) {
    assert.throws(() => parseApplication(value), hasKind("invalid_response"));
  }
  assert.throws(() => parseIngestKey({ ...keyMetadata, applicationId: "33333333-3333-4333-8333-333333333333" }, applicationId), hasKind("invalid_response"));
});

test("application list and creation use the exact management contract", async () => {
  const listed = fetched(response([application]));
  assert.deepEqual(await listed.source.list(), [application]);
  assert.equal(listed.calls[0][0], "http://localhost:3000/v1/applications");
  assert.equal(listed.calls[0][1].headers.Accept, "application/json");

  const created = fetched(response(application, 201));
  assert.deepEqual(await created.source.create("  Checkout application  "), application);
  assert.equal(created.calls[0][1].method, "POST");
  assert.deepEqual(JSON.parse(created.calls[0][1].body), { name: "Checkout application" });
});

test("status changes validate the returned application", async () => {
  const disabled = { ...application, status: "disabled", updatedAt: "2026-09-20T10:01:00.000Z" };
  const request = fetched(response(disabled));
  await assert.rejects(fetched(response({ ...application, name: "Other" }, 201)).source.create("Checkout application"), hasKind("uncertain"));
  assert.deepEqual(await request.source.setStatus(applicationId, "disabled"), disabled);
  assert.equal(request.calls[0][0], `http://localhost:3000/v1/applications/${applicationId}`);
  assert.deepEqual(JSON.parse(request.calls[0][1].body), { status: "disabled" });
  await assert.rejects(fetched(response(application)).source.setStatus(applicationId, "disabled"), hasKind("uncertain"));
});

test("key creation accepts the one-time secret while key listing returns metadata only", async () => {
  const listed = fetched(response([keyMetadata]));
  assert.deepEqual(await listed.source.listKeys(applicationId), [keyMetadata]);
  assert.equal(listed.calls[0][0], `http://localhost:3000/v1/applications/${applicationId}/ingest-keys`);

  const created = fetched(response({ ...keyMetadata, key: secret }, 201));
  assert.deepEqual(await created.source.createKey(applicationId, " Production collector "), { ...keyMetadata, key: secret });
  assert.deepEqual(JSON.parse(created.calls[0][1].body), { name: "Production collector" });
  await assert.rejects(fetched(response(keyMetadata, 201)).source.createKey(applicationId, "key"), hasKind("uncertain"));
});

test("key revocation requires a confirmed 204 and sends no secret", async () => {
  const revoked = fetched(response(undefined, 204));
  await revoked.source.revokeKey(applicationId, keyId);
  assert.equal(revoked.calls[0][1].method, "DELETE");
  await assert.rejects(fetched(response({ ...keyMetadata, prefix: "fedcba9876543210", key: secret }, 201)).source.createKey(applicationId, "Production collector"), hasKind("uncertain"));
  await assert.rejects(fetched(response({ ...keyMetadata, name: "Other", key: secret }, 201)).source.createKey(applicationId, "Production collector"), hasKind("uncertain"));
  assert.equal(revoked.calls[0][1].body, undefined);
  await assert.rejects(fetched(response({}, 200)).source.revokeKey(applicationId, keyId), hasKind("uncertain"));
});

test("invalid local names and identifiers do not dispatch", () => {
  const { source, calls } = fetched(response(application));
  assert.throws(() => source.create(" "), hasKind("validation"));
  assert.throws(() => source.create("x".repeat(101)), hasKind("validation"));
  assert.throws(() => source.listKeys("bad"), hasKind("validation"));
  assert.throws(() => source.createKey(applicationId, " "), hasKind("validation"));
  assert.throws(() => source.revokeKey(applicationId, "bad"), hasKind("validation"));
  assert.equal(calls.length, 0);
});

test("read and write timeouts settle transports that ignore AbortSignal without retrying", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const read = fetched(() => new Promise(() => {}));
  const pendingRead = assert.rejects(read.source.list(), hasKind("unavailable"));
  context.mock.timers.tick(APPLICATION_REQUEST_TIMEOUT_MS);
  await pendingRead;
  assert.equal(read.calls.length, 1);
  assert.equal(read.calls[0][1].signal.aborted, true);

  const write = fetched(() => new Promise(() => {}));
  const pendingWrite = assert.rejects(write.source.create("Checkout"), hasKind("uncertain"));
  context.mock.timers.tick(APPLICATION_REQUEST_TIMEOUT_MS);
  await pendingWrite;
  assert.equal(write.calls.length, 1);
  assert.equal(write.calls[0][1].signal.aborted, true);
});

test("caller cancellation is safe before dispatch and uncertain after a write dispatch", async () => {
  const before = new AbortController(); before.abort();
  const untouched = fetched(response([application]));
  await assert.rejects(untouched.source.list(before.signal), hasKind("aborted"));
  assert.equal(untouched.calls.length, 0);

  const after = new AbortController();
  const dispatched = fetched(() => new Promise(() => {}));
  const pending = assert.rejects(dispatched.source.create("Checkout", after.signal), hasKind("uncertain"));
  after.abort();
  await pending;
  assert.equal(dispatched.calls.length, 1);
});

test("collector settings preserve OTLP HTTP JSON endpoints and encode the bearer header", () => {
  const settings = collectorConfiguration("http://localhost:3000///", secret);
  assert.match(settings, /^OTEL_EXPORTER_OTLP_PROTOCOL=http\/json$/m);
  assert.match(settings, new RegExp(`^OTEL_EXPORTER_OTLP_HEADERS=Authorization=${encodeURIComponent(`Bearer ${secret}`)}$`, "m"));
  assert.match(settings, /^OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http:\/\/localhost:3000\/v1\/traces$/m);
  assert.match(settings, /^OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http:\/\/localhost:3000\/otlp\/v1\/metrics$/m);
  assert.match(settings, /^OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http:\/\/localhost:3000\/otlp\/v1\/logs$/m);
  assert.doesNotMatch(settings, /protobuf/);
});
