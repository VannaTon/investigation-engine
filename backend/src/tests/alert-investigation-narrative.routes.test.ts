import assert from "node:assert/strict";
import { Writable } from "node:stream";

import Fastify from "fastify";
import type { FastifyError, FastifyInstance } from "fastify";

import { NotFoundError } from "../error/not-found.error.js";
import type { AlertService } from "../services/alert.service.js";
import type { AlertInvestigationService } from "../services/alert-investigation.service.js";
import { GenericLlmNarrativeGeneratorError } from "../services/generic-llm-narrative-generator.service.js";
import { InvestigationNarrativeCooldownError } from "../services/alert-investigation-narrative.service.js";
import {
  InvestigationNarrativeGroundingError,
  InvestigationNarrativeSemanticValidationError,
} from "../services/investigation-narrative.service.js";
import { InvestigationNarrativeOutputParseError } from "../services/investigation-narrative-output-parser.service.js";
import {
  alertRoutes,
  type AlertInvestigationNarrativeServiceLike,
} from "../routes/alert.routes.js";
import type { InvestigationNarrativeOutput } from "../types/investigation-narrative-output.js";
import type { InvestigationNarrativeSnapshot } from "../types/investigation-narrative-snapshot.js";

const alertId = "24afd0ec-1843-488c-9577-8b897eafd0c1";

const successfulNarrative: InvestigationNarrativeOutput = {
  summary: {
    text: "Postgres is recommended for investigation first.",
    findingIds: ["finding:postgres"],
    signalIds: ["signal:trace-chain"],
  },
  candidates: [
    {
      candidateId: "candidate:postgres",
      text: "Postgres has high-severity observed leaf failure evidence.",
      findingIds: ["finding:postgres"],
      signalIds: ["signal:trace-chain"],
    },
  ],
};

const successfulSnapshot: InvestigationNarrativeSnapshot = {
  evidenceCutoff: "2026-08-15T06:30:00.000Z",
  generatedAt: "2026-08-15T06:30:02.000Z",
  contextHash:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  narrative: successfulNarrative,
};

class FakeNarrativeService implements AlertInvestigationNarrativeServiceLike {
  readonly generatedAlertIds: string[] = [];

  constructor(
    private readonly behavior: (
      alertId: string,
    ) => Promise<InvestigationNarrativeSnapshot>,
  ) {}

  async generate(alertId: string): Promise<InvestigationNarrativeSnapshot> {
    this.generatedAlertIds.push(alertId);

    return this.behavior(alertId);
  }
}

async function withTestApp(
  narrativeService: AlertInvestigationNarrativeServiceLike | undefined,
  run: (app: FastifyInstance) => Promise<void>,
  capturedLogs?: string[],
): Promise<void> {
  const app =
    capturedLogs === undefined
      ? Fastify({ logger: false })
      : Fastify({
          logger: {
            level: "warn",
            stream: new Writable({
              write(chunk, _encoding, callback) {
                capturedLogs.push(chunk.toString());
                callback();
              },
            }),
          },
        });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof NotFoundError) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: error.message,
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: error.message,
      });
    }

    request.log.error(error);

    return reply.status(500).send({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Internal Server Error",
    });
  });

  await app.register(alertRoutes, {
    alertService: {} as AlertService,
    alertInvestigationService: {} as AlertInvestigationService,
    getNarrativeService: () => narrativeService,
  });

  try {
    await run(app);
  } finally {
    await app.close();
  }
}

// Successful narratives pass through without route-specific transformation.
{
  const narrativeService = new FakeNarrativeService(
    async () => successfulSnapshot,
  );

  await withTestApp(narrativeService, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/alerts/${alertId}/investigation/narrative`,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), successfulSnapshot);
    assert.deepEqual(narrativeService.generatedAlertIds, [alertId]);
  });
}

// New hashes are rate-limited by the backend and expose Retry-After.
{
  const narrativeService = new FakeNarrativeService(async () => {
    throw new InvestigationNarrativeCooldownError(4_250);
  });

  await withTestApp(narrativeService, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/alerts/${alertId}/investigation/narrative`,
    });

    assert.equal(response.statusCode, 429);
    assert.equal(response.headers["retry-after"], "5");
    assert.deepEqual(response.json(), {
      error: {
        code: "NARRATIVE_GENERATION_COOLDOWN",
        message:
          "A new investigation narrative was generated recently. Retry after the cooldown.",
      },
    });
  });
}

// Missing optional LLM configuration leaves the core API healthy.
{
  await withTestApp(undefined, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/alerts/${alertId}/investigation/narrative`,
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      error: {
        code: "NARRATIVE_NOT_CONFIGURED",
        message: "Investigation narrative generation is not configured.",
      },
    });
  });
}

// Provider overload and rate limiting are temporary narrative unavailability.
for (const status of [503, 429]) {
  const narrativeService = new FakeNarrativeService(async () => {
    throw new GenericLlmNarrativeGeneratorError(
      "temporary provider failure",
      {
        kind: "http",
        status,
      },
    );
  });

  await withTestApp(narrativeService, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/alerts/${alertId}/investigation/narrative`,
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, "NARRATIVE_PROVIDER_UNAVAILABLE");
  });
}

// Provider rejection, invalid output, and grounding errors retain 502 behavior.
{
  const cases: Array<{
    error: Error;
    code: string;
  }> = [
    {
      error: new GenericLlmNarrativeGeneratorError(
        "provider rejected request",
        {
          kind: "http",
          status: 400,
        },
      ),
      code: "NARRATIVE_PROVIDER_ERROR",
    },
    {
      error: new InvestigationNarrativeOutputParseError(
        "$.summary",
        "Expected an object",
      ),
      code: "NARRATIVE_INVALID_OUTPUT",
    },
    {
      error: new InvestigationNarrativeGroundingError([
        {
          code: "unknown_finding",
          path: "summary.findingIds",
          message: "Unknown finding",
        },
      ]),
      code: "NARRATIVE_GROUNDING_FAILED",
    },
    {
      error: new InvestigationNarrativeSemanticValidationError([
        {
          code: "wrong_decisive_dimension",
          path: "summary.text",
          message: "Narrative used the wrong decisive dimension",
          comparisonId: "comparison:auth:user",
          expectedDimension: "support_diversity",
          detectedDimension: "trace_position",
          matchedClause: "trace position is stronger",
          sourceText:
            "auth-service ranks ahead of user-service because trace position is stronger",
          matchedCandidateIds: ["candidate:auth", "candidate:user"],
          matchedServices: ["auth-service", "user-service"],
        },
      ]),
      code: "NARRATIVE_SEMANTIC_VALIDATION_FAILED",
    },
  ];

  for (const testCase of cases) {
    const narrativeService = new FakeNarrativeService(async () => {
      throw testCase.error;
    });

    const capturedLogs =
      testCase.code === "NARRATIVE_SEMANTIC_VALIDATION_FAILED"
        ? []
        : undefined;

    await withTestApp(narrativeService, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/alerts/${alertId}/investigation/narrative`,
      });

      assert.equal(response.statusCode, 502);
      assert.equal(response.json().error.code, testCase.code);

      if (
        testCase.code ===
        "NARRATIVE_SEMANTIC_VALIDATION_FAILED"
      ) {
        assert.deepEqual(response.json(), {
          error: {
            code: "NARRATIVE_SEMANTIC_VALIDATION_FAILED",
            message:
              "Generated investigation narrative failed semantic validation.",
          },
        });

        assert.ok(capturedLogs);
        const semanticLog = capturedLogs
          .join("")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .find(
            (record) =>
              record.msg ===
              "Narrative failed semantic ranking validation",
          );

        assert.ok(semanticLog);
        const loggedIssues = semanticLog.issues as Array<
          Record<string, unknown>
        >;
        assert.equal(loggedIssues[0]!.expectedDimension, "support_diversity");
        assert.equal(loggedIssues[0]!.detectedDimension, "trace_position");
        assert.equal(
          loggedIssues[0]!.matchedClause,
          "trace position is stronger",
        );
        assert.equal(loggedIssues[0]!.path, "summary.text");
        assert.equal(
          loggedIssues[0]!.comparisonId,
          "comparison:auth:user",
        );
        assert.equal(
          loggedIssues[0]!.sourceText,
          "auth-service ranks ahead of user-service because trace position is stronger",
        );
        assert.deepEqual(loggedIssues[0]!.matchedCandidateIds, [
          "candidate:auth",
          "candidate:user",
        ]);
        assert.deepEqual(loggedIssues[0]!.matchedServices, [
          "auth-service",
          "user-service",
        ]);
      }
    }, capturedLogs);
  }
}

// Runtime provider failures are classified and logged without exposing details.
{
  const cases: Array<{
    error: GenericLlmNarrativeGeneratorError;
    expectedStatus: number;
    expectedCode: string;
    expectedMessage: string;
    expectedLogMessage: string;
  }> = [
    {
      error: new GenericLlmNarrativeGeneratorError(
        "private provider timeout detail",
        { kind: "timeout", timeoutMs: 180_000 },
      ),
      expectedStatus: 503,
      expectedCode: "NARRATIVE_PROVIDER_TIMEOUT",
      expectedMessage: "Investigation narrative generation timed out.",
      expectedLogMessage: "Narrative provider timed out",
    },
    {
      error: new GenericLlmNarrativeGeneratorError(
        "private network detail",
        { kind: "network" },
      ),
      expectedStatus: 503,
      expectedCode: "NARRATIVE_PROVIDER_UNAVAILABLE",
      expectedMessage:
        "Investigation narrative generation is temporarily unavailable.",
      expectedLogMessage: "Narrative provider unavailable",
    },
    {
      error: new GenericLlmNarrativeGeneratorError(
        "private malformed envelope detail",
        { kind: "invalid_response" },
      ),
      expectedStatus: 502,
      expectedCode: "NARRATIVE_PROVIDER_INVALID_RESPONSE",
      expectedMessage: "The narrative provider returned an invalid response.",
      expectedLogMessage: "Narrative provider returned an invalid response",
    },
    {
      error: new GenericLlmNarrativeGeneratorError(
        "private malformed model output detail",
        { kind: "invalid_output" },
      ),
      expectedStatus: 502,
      expectedCode: "NARRATIVE_INVALID_OUTPUT",
      expectedMessage: "The narrative provider returned an invalid response.",
      expectedLogMessage: "Narrative provider returned invalid output",
    },
  ];

  for (const testCase of cases) {
    const narrativeService = new FakeNarrativeService(async () => {
      throw testCase.error;
    });
    const capturedLogs: string[] = [];

    await withTestApp(narrativeService, async (app) => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/alerts/${alertId}/investigation/narrative`,
      });

      assert.equal(response.statusCode, testCase.expectedStatus);
      assert.deepEqual(response.json(), {
        error: {
          code: testCase.expectedCode,
          message: testCase.expectedMessage,
        },
      });
      assert.equal(response.body.includes(testCase.error.message), false);

      const providerLog = capturedLogs
        .join("")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((record) => record.msg === testCase.expectedLogMessage);

      assert.ok(providerLog);
      assert.equal(providerLog.providerFailureKind, testCase.error.kind);
      assert.equal(
        providerLog.providerFailureMessage,
        testCase.error.message,
      );

      if (testCase.error.timeoutMs !== undefined) {
        assert.equal(
          providerLog.providerTimeoutMs,
          testCase.error.timeoutMs,
        );
      }
    }, capturedLogs);
  }
}

// Fastify rejects malformed UUIDs before invoking narrative generation.
{
  const narrativeService = new FakeNarrativeService(
    async () => successfulSnapshot,
  );

  await withTestApp(narrativeService, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/alerts/not-a-uuid/investigation/narrative",
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(narrativeService.generatedAlertIds, []);
  });
}

// Deterministic investigation failures escape route-specific error mapping.
{
  const missingAlertId = "11111111-1111-4111-8111-111111111111";

  const narrativeService = new FakeNarrativeService(async () => {
    throw new NotFoundError("Alert not found.");
  });

  await withTestApp(narrativeService, async (app) => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/alerts/${missingAlertId}/investigation/narrative`,
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().message, "Alert not found.");
    assert.deepEqual(narrativeService.generatedAlertIds, [missingAlertId]);
  });
}

console.log("Alert investigation narrative route tests passed.");
