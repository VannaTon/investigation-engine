import { metricService } from "../composition/metrics.js";
import type { FastifyInstance } from "fastify";
import type { MetricEvent } from "../types/metric-event.js";
import type { MetricQuery } from "../types/metrics-query.js";
import { metricQueryService } from "../composition/metrics.js";
import type { MetricAggregateQuery } from "../types/metric-aggregate-query.js";

export async function metricRoute(app: FastifyInstance) {
  app.post<{ Body: MetricEvent }>("/v1/metrics", async (request) => {
    return metricService.ingest(request.body);
  });

  app.get<{ Querystring: MetricQuery }>("/v1/metrics", async (request) => {
    return metricQueryService.find(request.query);
  });

  app.get<{ Querystring: MetricAggregateQuery }>(
    "/v1/metrics/aggregate",
    async (request) => {
      return metricQueryService.aggregate(request.query);
    },
  );
}
