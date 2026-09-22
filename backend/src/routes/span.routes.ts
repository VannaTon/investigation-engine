import type { FastifyInstance } from "fastify";
import type { Span } from "../types/span.js";
import { spanIngestionService } from "../composition/span.js";
import { traceQueryService } from "../composition/trace.js";
import {
  ensureApplicationIdentityDecorator,
  ingestionAuthenticationHook,
  trustedApplicationId,
  type IngestionAuthenticator,
} from "./ingestion-auth.js";

export async function spanRoute(
  app: FastifyInstance,
  options: { authenticator: IngestionAuthenticator },
) {
  ensureApplicationIdentityDecorator(app);
  app.post<{ Body: Span }>(
    "/v1/spans",
    {
      onRequest: ingestionAuthenticationHook(options.authenticator),
    },
    async (request) => {
      return spanIngestionService.ingest({
        ...request.body,
        applicationId: trustedApplicationId(request),
      });
    },
  );

  app.get<{
    Params: { traceId: string };
    Querystring: { applicationId: string };
  }>(
    "/v1/traces/:traceId",
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
      console.log("Trace route hit");
      // 2. request.params.traceId is now safely typed as a string 🎉
      return traceQueryService.find(
        request.query.applicationId,
        request.params.traceId,
      );
    },
  );
}
