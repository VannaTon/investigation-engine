import type { FastifyInstance } from "fastify";
import type { ErrorGroup } from "../types/error-group.js";
import { errorGroupQueryService } from "../composition/error-group.js";
import type { ErrorGroupStatus } from "../types/error-group.js";
import { errorGroupCommandService } from "../composition/error-group-command.js";
export async function errorGroupRoute(app: FastifyInstance) {
  app.get<{ Body: ErrorGroup }>("/v1/errors/groups", async (request) => {
    return errorGroupQueryService.findAll();
  });

  app.get<{ Params: { fingerprint: string } }>(
    "/v1/errors/groups/:fingerprint",
    async (request) => {
      return errorGroupQueryService.find(request.params.fingerprint);
    },
  );

  app.patch<{
    Params: {
      fingerprint: string;
    };

    Body: {
      status: ErrorGroupStatus;
    };
  }>("/v1/errors/groups/:fingerprint", async (request) => {
    await errorGroupCommandService.updateStatus(
      request.params.fingerprint,
      request.body.status,
    );

    return {
      success: true,
    };
  });
}
