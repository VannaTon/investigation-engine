import { createClient } from "@clickhouse/client";

export const clickhouse = createClient({
  url: "http://localhost:8123",

  database: "observability",

  username: "admin",

  password: "password",
});
