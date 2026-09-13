import type { FastifyInstance } from "fastify";
import { investigationService } from "../composition/investigation.js";

export async function investigationRoute(app: FastifyInstance) {
  app.get<{ Params: { fingerprint: string } }>(
    "/v1/investigations/:fingerprint",
    async (request) => {
      return investigationService.find(request.params.fingerprint);
    },
  );
}
