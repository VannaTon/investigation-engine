import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  MetricDiscoveryInputError,
  parseMetricDiscoveryQuery,
  parseServiceDiscoveryQuery,
} from "../services/metric-discovery.service.js";
import type { MetricDiscoveryService } from "../services/metric-discovery.service.js";

export async function metricDiscoveryRoutes(
  app: FastifyInstance,
  options: { queryService: Pick<MetricDiscoveryService, "findServices" | "findMetrics"> },
): Promise<void> {
  async function execute(request: FastifyRequest, reply: FastifyReply, work: () => Promise<unknown>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof MetricDiscoveryInputError) {
        return reply.code(400).send({ statusCode: 400, error: "Bad Request", message: error.message });
      }
      // Database errors may contain SQL or credentials. Do not expose or log their raw details.
      request.log.warn("Recent metric discovery unavailable");
      return reply.code(503).send({ statusCode: 503, error: "Service Unavailable",
        message: "Recent metric discovery is unavailable. Try again later." });
    }
  }

  // These handlers validate native query values before any schema could coerce them.
  app.get("/v1/metrics/discovery/services", async (request, reply) =>
    execute(request, reply, () => options.queryService.findServices(parseServiceDiscoveryQuery(request.query))));
  app.get("/v1/metrics/discovery/metrics", async (request, reply) =>
    execute(request, reply, () => options.queryService.findMetrics(parseMetricDiscoveryQuery(request.query))));
}
