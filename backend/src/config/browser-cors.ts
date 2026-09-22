import type { FastifyCorsOptions } from "@fastify/cors";

export const browserCorsOptions: FastifyCorsOptions = {
  origin: ["http://localhost:4173", "http://localhost:5173"],
  methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
};
