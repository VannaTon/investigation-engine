import type { FastifyInstance } from "fastify";
import type { Span } from "../types/span.js";
import { spanIngestionService } from "../composition/span.js";
import { traceQueryService } from "../composition/trace.js";

export async function spanRoute(app: FastifyInstance) {
  app.post<{ Body: Span }>("/v1/spans", async (request) => {
    return spanIngestionService.ingest(request.body);
  });

  app.get<{ Params: { traceId: string } }>(
    "/v1/traces/:traceId",
    async (request) => {
      console.log("Trace route hit");
      // 2. request.params.traceId is now safely typed as a string 🎉
      return traceQueryService.find(request.params.traceId);
    },
  );
}
