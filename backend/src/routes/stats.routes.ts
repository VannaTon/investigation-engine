import type { FastifyInstance } from "fastify";
import { statsService } from "../composition/stats.js";

export async function statsRoute(app: FastifyInstance) {
  app.get("/v1/stats/log-levels", async () => {
    return statsService.countByLevel();
  });

  app.get("/v1/stats/services", async () => {
    return statsService.countByService();
  });

  app.get("/v1/stats/errors-over-time", async () => {
    return statsService.errorsOverTime();
  });

  app.get<{
    Querystring: {
      limit?: number;
    };
  }>("/v1/stats/top-errors", async (request) => {
    return statsService.topErrors(request.query.limit);
  });
}
