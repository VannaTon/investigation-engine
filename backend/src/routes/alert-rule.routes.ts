import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AlertRuleService } from "../services/alert-rule.service.js";
import { NotFoundError } from "../error/not-found.error.js";
import {
  AlertRuleInputError,
  parseCreateAlertRule,
  parseEnabled,
  parseReplacement,
} from "../services/alert-rule-input.js";

const idOptions = {
  schema: {
    params: {
      type: "object", required: ["id"], additionalProperties: false,
      properties: { id: { type: "string", format: "uuid" } },
    },
  },
} as const;

export async function alertRuleRoutes(
  app: FastifyInstance,
  options: {
    alertRuleService: Pick<AlertRuleService,
      "create" | "findAll" | "findById" | "updateEnabled" | "delete" | "editContext" | "replace">;
  },
): Promise<void> {
  const service = options.alertRuleService;

  async function execute(request: FastifyRequest, reply: FastifyReply, work: () => Promise<unknown>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AlertRuleInputError || error instanceof NotFoundError) {
        const statusCode = error instanceof AlertRuleInputError ? error.statusCode : 404;
        return reply.code(statusCode).send({
          statusCode,
          error: statusCode === 404 ? "Not Found" : statusCode === 409 ? "Conflict" : "Bad Request",
          message: error.message,
        });
      }
      request.log.error(error, "Alert rule request failed");
      return reply.code(500).send({
        statusCode: 500, error: "Internal Server Error",
        message: "Unable to complete the alert rule request.",
      });
    }
  }

  // Validation is explicit, before any body schema could coerce JSON types.
  app.post("/v1/alert-rules", async (request, reply) => execute(request, reply, async () => {
    const rule = await service.create(parseCreateAlertRule(request.body));
    return reply.code(201).send(rule);
  }));

  app.get("/v1/alert-rules", async (request, reply) =>
    execute(request, reply, () => service.findAll()));

  app.get("/v1/alert-rules/:id", idOptions, async (request, reply) => {
    const { id } = request.params as { id: string };
    return execute(request, reply, () => service.findById(id));
  });

  app.get("/v1/alert-rules/:id/edit-context", idOptions, async (request, reply) => {
    const { id } = request.params as { id: string };
    return execute(request, reply, () => service.editContext(id));
  });

  app.post("/v1/alert-rules/:id/replacements", idOptions, async (request, reply) => {
    const { id } = request.params as { id: string };
    return execute(request, reply, async () => {
      const body = parseReplacement(request.body);
      const result = await service.replace(id, { name: body.name, config: body.config }, body.revisionToken);
      return reply.code(201).send(result);
    });
  });

  app.patch("/v1/alert-rules/:id", idOptions, async (request, reply) => {
    const { id } = request.params as { id: string };
    return execute(request, reply, () => service.updateEnabled(id, parseEnabled(request.body)));
  });

  // Retain the existing API; the new UI deliberately offers no delete action.
  app.delete("/v1/alert-rules/:id", idOptions, async (request, reply) => {
    const { id } = request.params as { id: string };
    return execute(request, reply, async () => {
      await service.delete(id);
      return reply.code(204).send();
    });
  });
}
