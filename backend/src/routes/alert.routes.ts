import type { FastifyInstance } from "fastify";
import { AlertTransitionError } from "../error/alert-transition.error.js";
import { NotFoundError } from "../error/not-found.error.js";
import type { AlertStatus } from "../types/alert.js";
import { AlertService } from "../services/alert.service.js";
import { AlertInvestigationService } from "../services/alert-investigation.service.js";
import { hasLlmProviderConfig } from "../config/llm.js";
import { createAlertInvestigationNarrativeService } from "../config/investigation-narrative.js";
import {
  AlertInvestigationNarrativeService,
  InvestigationNarrativeCooldownError,
} from "../services/alert-investigation-narrative.service.js";
import { GenericLlmNarrativeGeneratorError } from "../services/generic-llm-narrative-generator.service.js";
import {
  InvestigationNarrativeGroundingError,
  InvestigationNarrativeSemanticValidationError,
} from "../services/investigation-narrative.service.js";
import { InvestigationNarrativeOutputParseError } from "../services/investigation-narrative-output-parser.service.js";

const alertIdParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: {
      type: "string",
      format: "uuid",
    },
  },
} as const;

export type AlertInvestigationNarrativeServiceLike = Pick<
  AlertInvestigationNarrativeService,
  "generate"
>;

export interface AlertRoutesOptions {
  alertService: AlertService;
  alertInvestigationService: AlertInvestigationService;
  getNarrativeService?: () =>
    | AlertInvestigationNarrativeServiceLike
    | undefined;
}

function narrativeProviderLogDetails(
  error: GenericLlmNarrativeGeneratorError,
): Record<string, unknown> {
  return {
    providerFailureKind: error.kind,
    providerFailureMessage: error.message,
    ...(error.status !== undefined
      ? { providerStatus: error.status }
      : {}),
    ...(error.timeoutMs !== undefined
      ? { providerTimeoutMs: error.timeoutMs }
      : {}),
  };
}

export async function alertRoutes(
  app: FastifyInstance,
  options: AlertRoutesOptions,
): Promise<void> {
  const { alertService, alertInvestigationService } = options;

  let narrativeService: AlertInvestigationNarrativeService | undefined;

  function getDefaultNarrativeService():
    | AlertInvestigationNarrativeService
    | undefined {
    if (!hasLlmProviderConfig()) {
      return undefined;
    }

    if (!narrativeService) {
      narrativeService = createAlertInvestigationNarrativeService(
        alertInvestigationService,
      );
    }

    return narrativeService;
  }

  const getNarrativeService =
    options.getNarrativeService ?? getDefaultNarrativeService;

  app.get("/v1/alerts", async () => {
    return alertService.findAll();
  });

  app.get("/v1/alerts/:id", async (request) => {
    const { id } = request.params as {
      id: string;
    };

    return alertService.findById(id);
  });

  app.patch("/v1/alerts/:id/status", {
    async preValidation(request, reply) {
      const body = request.body;
      // Check the original shape before Fastify's validator can coerce values.
      if (!body || typeof body !== "object" || Array.isArray(body)
        || !("status" in body) || typeof body.status !== "string"
        || Object.keys(body).some((key) => key !== "status")) {
        return reply.code(400).send({
          statusCode: 400, error: "Bad Request",
          message: "Expected an object containing a string status.",
        });
      }
    },
    schema: {
      params: alertIdParamsSchema,
      body: {
        type: "object",
        required: ["status"],
        additionalProperties: false,
        properties: { status: { type: "string", enum: ["firing", "acknowledged", "resolved"] } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as {
      id: string;
    };

    const body = request.body as {
      status: AlertStatus;
    };

    try {
      return await alertService.updateStatus(id, body.status);
    } catch (error) {
      if (error instanceof AlertTransitionError || error instanceof NotFoundError) {
        const statusCode = error instanceof AlertTransitionError ? error.statusCode : 404;
        return reply.code(statusCode).send({
          statusCode,
          error: statusCode === 404 ? "Not Found" : statusCode === 409 ? "Conflict" : "Bad Request",
          message: error.message,
        });
      }
      throw error;
    }
  });

  app.get(
    "/v1/alerts/:id/investigation",
    {
      schema: {
        params: alertIdParamsSchema,
      },
    },
    async (request) => {
      const { id } = request.params as {
        id: string;
      };

      return alertInvestigationService.investigate(id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/alerts/:id/investigation/narrative",
    {
      schema: {
        params: alertIdParamsSchema,
      },
    },
    async (request, reply) => {
      const service = getNarrativeService();

      if (!service) {
        return reply.code(503).send({
          error: {
            code: "NARRATIVE_NOT_CONFIGURED",
            message: "Investigation narrative generation is not configured.",
          },
        });
      }

      try {
        const snapshot = await service.generate(request.params.id);

        return reply.code(200).send(snapshot);
      } catch (error) {
        if (error instanceof InvestigationNarrativeCooldownError) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil(error.retryAfterMs / 1_000),
          );

          return reply
            .header("retry-after", String(retryAfterSeconds))
            .code(429)
            .send({
              error: {
                code: "NARRATIVE_GENERATION_COOLDOWN",
                message:
                  "A new investigation narrative was generated recently. Retry after the cooldown.",
              },
            });
        }

        if (error instanceof GenericLlmNarrativeGeneratorError) {
          const logDetails = narrativeProviderLogDetails(error);

          if (error.kind === "timeout") {
            request.log.warn(logDetails, "Narrative provider timed out");

            return reply.code(503).send({
              error: {
                code: "NARRATIVE_PROVIDER_TIMEOUT",
                message: "Investigation narrative generation timed out.",
              },
            });
          }

          if (error.kind === "network") {
            request.log.warn(logDetails, "Narrative provider unavailable");

            return reply.code(503).send({
              error: {
                code: "NARRATIVE_PROVIDER_UNAVAILABLE",
                message:
                  "Investigation narrative generation is temporarily unavailable.",
              },
            });
          }

          if (error.kind === "invalid_response") {
            request.log.warn(
              logDetails,
              "Narrative provider returned an invalid response",
            );

            return reply.code(502).send({
              error: {
                code: "NARRATIVE_PROVIDER_INVALID_RESPONSE",
                message: "The narrative provider returned an invalid response.",
              },
            });
          }

          if (error.kind === "invalid_output") {
            request.log.warn(
              logDetails,
              "Narrative provider returned invalid output",
            );

            return reply.code(502).send({
              error: {
                code: "NARRATIVE_INVALID_OUTPUT",
                message: "The narrative provider returned an invalid response.",
              },
            });
          }

          if (
            error.status === 429 ||
            (error.status !== undefined && error.status >= 500)
          ) {
            request.log.warn(logDetails, "Narrative provider unavailable");

            return reply.code(503).send({
              error: {
                code: "NARRATIVE_PROVIDER_UNAVAILABLE",
                message:
                  "Investigation narrative generation is temporarily unavailable.",
              },
            });
          }

          request.log.error(logDetails, "Narrative provider request failed");

          return reply.code(502).send({
            error: {
              code: "NARRATIVE_PROVIDER_ERROR",
              message: "The configured narrative provider rejected the request.",
            },
          });
        }

        if (error instanceof InvestigationNarrativeOutputParseError) {
          request.log.warn(
            { error },
            "Narrative provider returned invalid output",
          );

          return reply.code(502).send({
            error: {
              code: "NARRATIVE_INVALID_OUTPUT",
              message: "The narrative provider returned an invalid response.",
            },
          });
        }

        if (error instanceof InvestigationNarrativeGroundingError) {
          request.log.warn(
            { issues: error.issues },
            "Narrative failed grounding validation",
          );

          return reply.code(502).send({
            error: {
              code: "NARRATIVE_GROUNDING_FAILED",
              message:
                "The generated narrative could not be validated against investigation evidence.",
            },
          });
        }

        if (
          error instanceof InvestigationNarrativeSemanticValidationError
        ) {
          request.log.warn(
            { issues: error.issues },
            "Narrative failed semantic ranking validation",
          );

          return reply.code(502).send({
            error: {
              code: "NARRATIVE_SEMANTIC_VALIDATION_FAILED",
              message:
                "Generated investigation narrative failed semantic validation.",
            },
          });
        }

        throw error;
      }
    },
  );

  app.patch("/v1/alerts/:id/investigation/window", async (request) => {
    const { id } = request.params as {
      id: string;
    };

    const body = request.body as {
      from: string;
      to: string;
    };

    return alertInvestigationService.updateWindow(id, body.from, body.to);
  });
}
