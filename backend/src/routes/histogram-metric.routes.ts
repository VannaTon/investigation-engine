import type { FastifyInstance } from "fastify";
import {
  HistogramMetricQueryError,
  MAX_HISTOGRAM_METRIC_QUERY_LIMIT,
} from "../repository/histogram-metric.repository.js";
import type { HistogramMetricQueryService } from "../services/histogram-metric-query.service.js";
import type { HistogramMetricQuery } from "../types/histogram-metric-query.js";

export interface HistogramMetricRouteOptions {
  queryService: Pick<HistogramMetricQueryService, "find">;
}

export async function histogramMetricRoute(
  app: FastifyInstance,
  options: HistogramMetricRouteOptions,
): Promise<void> {
  app.get<{ Querystring: HistogramMetricQuery }>(
    "/v1/metric-histograms",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["applicationId"],
          properties: {
            applicationId: { type: "string", minLength: 1 },
            service: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            from: { type: "string", minLength: 1 },
            to: { type: "string", minLength: 1 },
            cursor: { type: "string", minLength: 1 },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: MAX_HISTOGRAM_METRIC_QUERY_LIMIT,
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await options.queryService.find(request.query);
      } catch (error) {
        if (error instanceof HistogramMetricQueryError) {
          return reply.code(400).send({
            statusCode: 400,
            error: "Bad Request",
            message: error.message,
          });
        }

        throw error;
      }
    },
  );
}
