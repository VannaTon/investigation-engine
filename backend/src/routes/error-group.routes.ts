import type { FastifyInstance } from "fastify";
import type { ErrorGroup } from "../types/error-group.js";
import { errorGroupQueryService } from "../composition/error-group.js";
import type { ErrorGroupStatus } from "../types/error-group.js";
import { errorGroupCommandService } from "../composition/error-group-command.js";
const applicationQueryOptions = {
  schema: {
    querystring: {
      type: "object",
      required: ["applicationId"],
      properties: { applicationId: { type: "string", minLength: 1 } },
    },
  },
} as const;

export async function errorGroupRoute(app: FastifyInstance) {
  app.get<{ Querystring: { applicationId: string } }>("/v1/errors/groups", applicationQueryOptions, async (request) => {
    return errorGroupQueryService.findAll(request.query.applicationId);
  });

  app.get<{
    Params: { fingerprint: string };
    Querystring: { applicationId: string };
  }>(
    "/v1/errors/groups/:fingerprint",
    applicationQueryOptions,
    async (request) => {
      return errorGroupQueryService.find(request.query.applicationId, request.params.fingerprint);
    },
  );

  app.patch<{
    Params: {
      fingerprint: string;
    };
    Querystring: { applicationId: string };

    Body: {
      status: ErrorGroupStatus;
    };
  }>("/v1/errors/groups/:fingerprint", applicationQueryOptions, async (request) => {
    await errorGroupCommandService.updateStatus(
      request.query.applicationId,
      request.params.fingerprint,
      request.body.status,
    );

    return {
      success: true,
    };
  });
}
