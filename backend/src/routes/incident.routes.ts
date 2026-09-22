import type { FastifyInstance } from "fastify";
import { incidentQueryService } from "../composition/incident.js";

export async function incidentRoute(app: FastifyInstance) {
  app.get<{
    Params: { traceId: string };
    Querystring: { applicationId: string };
  }>(
    "/v1/incidents/:traceId",
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
      return incidentQueryService.find(request.query.applicationId, request.params.traceId);
    },
  );
}
