import Fastify from "fastify";
import { healthRoute } from "./routes/health.routes.js";
import { logRoute } from "./routes/log.routes.js";
import { otlpLogRoute } from "./routes/otlp-log.routes.js";
import { logIngestionService } from "./composition/log.js";
import redisPlugin from "./plugin/redis.plugin.js";
import clickhousePlugin from "./plugin/clickhouse.plugin.js";
import { statsRoute } from "./routes/stats.routes.js";
import { spanRoute } from "./routes/span.routes.js";
import { incidentRoute } from "./routes/incident.routes.js";
import postgresPlugin from "./plugin/postgre.plugin.js";
import { errorGroupRoute } from "./routes/error-group.routes.js";
import { investigationRoute } from "./routes/investigation.routes.js";
import { metricRoute } from "./routes/metric.routes.js";
import { alertRuleService } from "./composition/alert-rule.js";
import { alertRuleRoutes } from "./routes/alert-rule.routes.js";
import { alertRoutes } from "./routes/alert.routes.js";
import { alertService } from "./composition/alert-rule.js";
import { alertInvestigationService } from "./composition/alert-rule.js";
import cors from "@fastify/cors";
import { browserCorsOptions } from "./config/browser-cors.js";
import { NotFoundError } from "./error/not-found.error.js";
import type { FastifyError } from "fastify";
import { otlpTraceRoute } from "./routes/otlp-trace.routes.js";
import { spanIngestionService } from "./composition/span.js";
import { otlpMetricRoute } from "./routes/otlp-metric.routes.js";
import { metricService as otlpMetricIngestionService } from "./composition/metrics.js";
import { isOtlpExplicitHistogramsEnabled } from "./config/histogram-metrics.js";
import {
  histogramMetricQueryService,
  histogramMetricService,
} from "./composition/histogram-metrics.js";
import { histogramMetricRoute } from "./routes/histogram-metric.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, browserCorsOptions);
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof NotFoundError) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: error.message,
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: error.message,
      });
    }

    request.log.error(error);

    return reply.status(500).send({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Internal Server Error",
    });
  });
  await app.register(redisPlugin);
  await app.register(clickhousePlugin);
  await app.register(postgresPlugin);
  await app.register(statsRoute);
  await app.register(spanRoute);
  await app.register(otlpTraceRoute, {
    spanIngestionService,
  });
  await app.register(otlpMetricRoute, {
    metricIngestionService: otlpMetricIngestionService,
    histogramMetricIngestionService: histogramMetricService,
    explicitHistogramsEnabled: isOtlpExplicitHistogramsEnabled(),
  });
  await app.register(otlpLogRoute, {
    logIngestionService,
  });
  await app.register(incidentRoute);
  await app.register(healthRoute);
  await app.register(logRoute);
  await app.register(errorGroupRoute);
  await app.register(investigationRoute);
  await app.register(metricRoute);
  await app.register(histogramMetricRoute, {
    queryService: histogramMetricQueryService,
  });
  await app.register(alertRuleRoutes, {
    alertRuleService,
  });
  await app.register(alertRoutes, {
    alertService,
    alertInvestigationService,
  });

  return app;
}
