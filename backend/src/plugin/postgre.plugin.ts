import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { postgres } from "../config/postgres.js";

const postgresPlugin: FastifyPluginAsync = async (app) => {
  try {
    await postgres.query("SELECT NOW()");
    app.log.info("PostgreSQL connected");
  } catch (error) {
    app.log.error(error, "Failed to connect to PostgreSQL");
    throw error;
  }

  app.addHook("onClose", async () => {
    await postgres.end();
    app.log.info("PostgreSQL disconnected");
  });
};

export default fp(postgresPlugin);
