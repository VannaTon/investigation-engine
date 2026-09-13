import type { FastifyInstance } from "fastify";
import type { LogEvent } from "../types/log-event.js";
import type { LogQuery } from "../types/log.query.js";
import { logIngestionService, logQueryService } from "../composition/log.js";

export async function logRoute(app: FastifyInstance) {
  app.post<{ Body: LogEvent }>("/v1/logs", async (request) => {
    return logIngestionService.ingest(request.body);
  });

  app.get<{ Querystring: LogQuery }>("/v1/logs", async (request) => {
    const query: LogQuery = {};

    if (request.query.service) {
      query.service = request.query.service;
    }

    if (request.query.level) {
      query.level = request.query.level;
    }

    if (request.query.from) {
      query.from = request.query.from;
    }

    if (request.query.to) {
      query.to = request.query.to;
    }
    if (request.query.cursor) {
      query.cursor = request.query.cursor;
    }
    if (request.query.search) {
      query.search = request.query.search;
    }
    if (request.query.traceId) {
      query.traceId = request.query.traceId;
    }
    return logQueryService.find(query);
  });
}
