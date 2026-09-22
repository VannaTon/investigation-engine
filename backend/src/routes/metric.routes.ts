import { metricService } from "../composition/metrics.js";
import type { FastifyInstance } from "fastify";
import type { MetricEvent } from "../types/metric-event.js";
import type { MetricQuery } from "../types/metrics-query.js";
import { metricQueryService } from "../composition/metrics.js";
import type { MetricAggregateQuery } from "../types/metric-aggregate-query.js";
import {
  ensureApplicationIdentityDecorator,
  ingestionAuthenticationHook,
  trustedApplicationId,
  type IngestionAuthenticator,
} from "./ingestion-auth.js";

export async function metricRoute(
  app: FastifyInstance,
  options: { authenticator: IngestionAuthenticator },
) {
  ensureApplicationIdentityDecorator(app);
  app.post<{ Body: MetricEvent }>(
    "/v1/metrics",
    {
      onRequest: ingestionAuthenticationHook(options.authenticator),
    },
    async (request) => {
      return metricService.ingest({
        ...request.body,
        applicationId: trustedApplicationId(request),
      });
    },
  );

  const applicationQuerySchema = {
    type: "object",
    required: ["applicationId"],
    properties: { applicationId: { type: "string", minLength: 1 } },
  } as const;

  app.get<{ Querystring: MetricQuery }>("/v1/metrics", {
    schema: { querystring: applicationQuerySchema },
  }, async (request) => {
    return metricQueryService.find(request.query);
  });

  app.get<{ Querystring: MetricAggregateQuery }>(
    "/v1/metrics/aggregate",
    { schema: { querystring: applicationQuerySchema } },
    async (request) => {
      return metricQueryService.aggregate(request.query);
    },
  );
}
