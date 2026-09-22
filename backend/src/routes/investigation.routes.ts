import type { FastifyInstance } from "fastify";
import { investigationService } from "../composition/investigation.js";

export async function investigationRoute(app: FastifyInstance) {
  app.get<{
    Params: { fingerprint: string };
    Querystring: { applicationId: string };
  }>(
    "/v1/investigations/:fingerprint",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["applicationId"],
          properties: { applicationId: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request) => {
      return investigationService.find(request.query.applicationId, request.params.fingerprint);
    },
  );
}
