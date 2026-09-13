import fp from "fastify-plugin";
import { redis } from "../config/redis.js";

export default fp(async (fastify) => {
  await redis.connect();

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async () => {
    await redis.quit();
  });
});
