import type { FastifyInstance } from "fastify";
import { incidentQueryService } from "../composition/incident.js";

export async function incidentRoute(app: FastifyInstance) {
  app.get<{ Params: { traceId: string } }>(
    "/v1/incidents/:traceId",
    async (request) => {
      return incidentQueryService.find(request.params.traceId);
    },
  );
}
