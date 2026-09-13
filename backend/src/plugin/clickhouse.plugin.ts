import fp from "fastify-plugin";
import { clickhouse } from "../config/clickhouse.js";
import { SchemaInitializer } from "../database/shema.js";

export default fp(async () => {
  console.log("Connecting to ClickHouse...");

  await clickhouse.ping();

  console.log("ClickHouse connected.");

  const schema = new SchemaInitializer();

  await schema.initialize();
});
