import type { FastifyInstance } from "fastify";

export async function healthRoute(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "ingestion-api",
    };
  });
}
