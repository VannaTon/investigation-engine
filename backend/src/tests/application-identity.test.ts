import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { readIngestionAuthMode } from "../config/ingestion-auth.js";
import {
  ApplicationAuthenticationError,
  ApplicationService,
  hashIngestionKey,
} from "../services/application.service.js";
import {
  otlpTraceRoute,
  type OtlpSpanIngestionServiceLike,
} from "../routes/otlp-trace.routes.js";
import { applicationRoutes } from "../routes/application.routes.js";
import {
  LOCAL_DEVELOPMENT_APPLICATION_ID,
  type Application,
  type ApplicationIngestKey,
  type ApplicationTelemetry,
} from "../types/application.js";
import type { Span } from "../types/span.js";
import type { ApplicationKeyAuthenticationRecord } from "../repository/application.repository.js";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const KEY_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-09-20T00:00:00.000Z";

function harness() {
  const application: Application = {
    id: APPLICATION_ID,
    name: "Checkout",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
  let storedInput:
    | {
        applicationId: string;
        name: string;
        prefix: string;
        secretHash: string;
      }
    | undefined;
  let authenticationRecord: ApplicationKeyAuthenticationRecord | null = null;
  let markUsedCount = 0;
  let listedKeys: ApplicationIngestKey[] = [];

  const repository = {
    async create(name: string) {
      return { ...application, name };
    },
    async findAll() {
      return [application];
    },
    async findById(id: string) {
      return id === application.id ? application : null;
    },
    async updateStatus(_id: string, status: Application["status"]) {
      return { ...application, status };
    },
    async createIngestKey(input: {
      applicationId: string;
      name: string;
      prefix: string;
      secretHash: string;
    }) {
      storedInput = input;
      const created: ApplicationIngestKey = {
        id: KEY_ID,
        applicationId: input.applicationId,
        name: input.name,
        prefix: input.prefix,
        createdAt: NOW,
      };
      listedKeys = [created];
      return created;
    },
    async listIngestKeys() {
      return listedKeys;
    },
    async findKeyForAuthentication(prefix: string) {
      return authenticationRecord?.id !== undefined &&
        storedInput?.prefix === prefix
        ? authenticationRecord
        : null;
    },
    async markKeyUsed() {
      markUsedCount++;
    },
    async revokeIngestKey() {
      return true;
    },
  };

  return {
    application,
    repository,
    getStoredInput: () => storedInput,
    setAuthenticationRecord: (
      value: ApplicationKeyAuthenticationRecord | null,
    ) => {
      authenticationRecord = value;
    },
    getMarkUsedCount: () => markUsedCount,
  };
}

function deterministicRandom(size: number): Buffer {
  return Buffer.alloc(size, size === 8 ? 0xaa : 0xbb);
}

function traceRequest(): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "checkout-service" },
            },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: "5B8EFFF798038103D269B633813FC60C",
                spanId: "EEE19B7EC3C1B174",
                parentSpanId: "",
                name: "POST /checkout",
                startTimeUnixNano: "1000000000",
                endTimeUnixNano: "1250000000",
                status: { code: 0 },
              },
            ],
          },
        ],
      },
    ],
  };
}

test("normal mode is secure by default and development bypass is explicit", async () => {
  assert.equal(readIngestionAuthMode(undefined), "required");
  assert.equal(readIngestionAuthMode("development"), "development");
  assert.throws(() => readIngestionAuthMode("optional"), /must be either/);

  const required = new ApplicationService(harness().repository as never, "required");
  await assert.rejects(
    required.authenticateAuthorizationHeader(undefined),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationAuthenticationError);
      assert.equal(error.failure, "missing");
      assert.equal(error.statusCode, 401);
      return true;
    },
  );

  const development = new ApplicationService(
    harness().repository as never,
    "development",
  );
  assert.equal(
    await development.authenticateAuthorizationHeader(undefined),
    LOCAL_DEVELOPMENT_APPLICATION_ID,
  );
  await assert.rejects(
    development.authenticateAuthorizationHeader("Bearer invalid"),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationAuthenticationError);
      assert.equal(error.failure, "malformed");
      return true;
    },
  );
});

test("ingestion keys are hashed at rest, returned once, and enforce lifecycle", async () => {
  const state = harness();
  const service = new ApplicationService(
    state.repository as never,
    "required",
    deterministicRandom,
  );
  const created = await service.createIngestKey(APPLICATION_ID, {
    name: "Production collector",
  });
  const stored = state.getStoredInput();

  assert.ok(stored);
  assert.match(created.key, /^op_ingest_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
  assert.equal(stored.secretHash, hashIngestionKey(created.key));
  assert.equal("key" in stored, false);
  assert.equal(
    (await service.listIngestKeys(APPLICATION_ID))[0]?.prefix,
    created.prefix,
  );
  assert.equal(
    "key" in ((await service.listIngestKeys(APPLICATION_ID))[0] ?? {}),
    false,
  );

  state.setAuthenticationRecord({
    id: KEY_ID,
    applicationId: APPLICATION_ID,
    secretHash: stored.secretHash,
    applicationStatus: "active",
  });
  assert.equal(
    await service.authenticateAuthorizationHeader("Bearer " + created.key),
    APPLICATION_ID,
  );
  assert.equal(state.getMarkUsedCount(), 1);

  state.setAuthenticationRecord({
    id: KEY_ID,
    applicationId: APPLICATION_ID,
    secretHash: stored.secretHash,
    revokedAt: NOW,
    applicationStatus: "active",
  });
  await assert.rejects(
    service.authenticateAuthorizationHeader("Bearer " + created.key),
    (error: unknown) =>
      error instanceof ApplicationAuthenticationError &&
      error.failure === "revoked" &&
      error.statusCode === 401,
  );

  state.setAuthenticationRecord({
    id: KEY_ID,
    applicationId: APPLICATION_ID,
    secretHash: stored.secretHash,
    applicationStatus: "disabled",
  });
  await assert.rejects(
    service.authenticateAuthorizationHeader("Bearer " + created.key),
    (error: unknown) =>
      error instanceof ApplicationAuthenticationError &&
      error.failure === "application_disabled" &&
      error.statusCode === 403,
  );
});

test("OTLP path rejects missing auth and publishes only server-attributed identity", async () => {
  const state = harness();
  const service = new ApplicationService(
    state.repository as never,
    "required",
    deterministicRandom,
  );
  const created = await service.createIngestKey(APPLICATION_ID, { name: "OTLP" });
  const stored = state.getStoredInput();
  assert.ok(stored);
  state.setAuthenticationRecord({
    id: KEY_ID,
    applicationId: APPLICATION_ID,
    secretHash: stored.secretHash,
    applicationStatus: "active",
  });

  const published: Array<ApplicationTelemetry<Span>> = [];
  const ingestion: OtlpSpanIngestionServiceLike = {
    async ingest(span) {
      published.push(span);
      return { accepted: true, eventId: "event-1" };
    },
  };
  const app = Fastify({ logger: false });
  await app.register(otlpTraceRoute, {
    spanIngestionService: ingestion,
    authenticator: service,
  });

  try {
    const missing = await app.inject({
      method: "POST",
      url: "/v1/traces",
      payload: traceRequest(),
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(published.length, 0);

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/traces",
      headers: { authorization: "Bearer " + created.key },
      payload: traceRequest(),
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(published.length, 1);
    assert.equal(published[0]?.applicationId, APPLICATION_ID);
  } finally {
    await app.close();
  }
});

test("application management returns a key once and never leaks it from key listings", async () => {
  const state = harness();
  const service = new ApplicationService(
    state.repository as never,
    "required",
    deterministicRandom,
  );
  const app = Fastify({ logger: false });
  await app.register(applicationRoutes, { applicationService: service });

  try {
    const createdApplication = await app.inject({
      method: "POST",
      url: "/v1/applications",
      payload: { name: "  Checkout API  " },
    });
    assert.equal(createdApplication.statusCode, 201);
    assert.equal(createdApplication.json().name, "Checkout API");

    const badApplication = await app.inject({
      method: "POST",
      url: "/v1/applications",
      payload: { name: " " },
    });
    assert.equal(badApplication.statusCode, 400);

    const createdKey = await app.inject({
      method: "POST",
      url: "/v1/applications/" + APPLICATION_ID + "/ingest-keys",
      payload: { name: "  Production collector  " },
    });
    assert.equal(createdKey.statusCode, 201);
    assert.match(
      createdKey.json().key,
      /^op_ingest_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/,
    );
    assert.equal(createdKey.json().name, "Production collector");

    const listedKeys = await app.inject({
      method: "GET",
      url: "/v1/applications/" + APPLICATION_ID + "/ingest-keys",
    });
    assert.equal(listedKeys.statusCode, 200);
    assert.equal(listedKeys.json().length, 1);
    assert.equal(listedKeys.json()[0].prefix, createdKey.json().prefix);
    assert.equal("key" in listedKeys.json()[0], false);
    assert.equal("secretHash" in listedKeys.json()[0], false);

    const disabled = await app.inject({
      method: "PATCH",
      url: "/v1/applications/" + APPLICATION_ID,
      payload: { status: "disabled" },
    });
    assert.equal(disabled.statusCode, 200);
    assert.equal(disabled.json().id, APPLICATION_ID);
    assert.equal(disabled.json().status, "disabled");

    const revoked = await app.inject({
      method: "DELETE",
      url:
        "/v1/applications/" +
        APPLICATION_ID +
        "/ingest-keys/" +
        KEY_ID,
    });
    assert.equal(revoked.statusCode, 204);
    assert.equal(revoked.body, "");
  } finally {
    await app.close();
  }
});
