import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import {
  ApplicationInputError,
  type ApplicationService,
} from "../services/application.service.js";

const uuidParams = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", format: "uuid" },
  },
} as const;

const keyUuidParams = {
  type: "object",
  required: ["id", "keyId"],
  additionalProperties: false,
  properties: {
    id: { type: "string", format: "uuid" },
    keyId: { type: "string", format: "uuid" },
  },
} as const;

export async function applicationRoutes(
  app: FastifyInstance,
  options: { applicationService: ApplicationService },
): Promise<void> {
  const service = options.applicationService;

  async function execute(
    request: FastifyRequest,
    reply: FastifyReply,
    work: () => Promise<unknown>,
  ): Promise<unknown> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApplicationInputError) {
        return reply.code(error.statusCode).send({
          statusCode: error.statusCode,
          error:
            error.statusCode === 404 ? "Not Found" : "Bad Request",
          message: error.message,
        });
      }

      request.log.error(error, "Application management request failed");
      return reply.code(500).send({
        statusCode: 500,
        error: "Internal Server Error",
        message: "Unable to complete the application request.",
      });
    }
  }

  app.get("/v1/applications", async (request, reply) =>
    execute(request, reply, () => service.findAll()),
  );

  app.post("/v1/applications", async (request, reply) =>
    execute(request, reply, async () =>
      reply.code(201).send(await service.create(request.body)),
    ),
  );

  app.get(
    "/v1/applications/:id",
    { schema: { params: uuidParams } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return execute(request, reply, () => service.findById(id));
    },
  );

  app.patch(
    "/v1/applications/:id",
    { schema: { params: uuidParams } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return execute(request, reply, () =>
        service.updateStatus(id, request.body),
      );
    },
  );

  app.get(
    "/v1/applications/:id/ingest-keys",
    { schema: { params: uuidParams } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return execute(request, reply, () => service.listIngestKeys(id));
    },
  );

  app.post(
    "/v1/applications/:id/ingest-keys",
    { schema: { params: uuidParams } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return execute(request, reply, async () =>
        reply
          .code(201)
          .send(await service.createIngestKey(id, request.body)),
      );
    },
  );

  app.delete(
    "/v1/applications/:id/ingest-keys/:keyId",
    { schema: { params: keyUuidParams } },
    async (request, reply) => {
      const { id, keyId } = request.params as {
        id: string;
        keyId: string;
      };
      return execute(request, reply, async () => {
        await service.revokeIngestKey(id, keyId);
        return reply.code(204).send();
      });
    },
  );
}
