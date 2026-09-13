import assert from "node:assert/strict";

import { toClickHouseDateTime64 } from "../repository/clickhouse-datetime.js";

assert.equal(
  toClickHouseDateTime64("2026-08-15T06:30:00.000Z"),
  "2026-08-15 06:30:00.000",
  "UTC ISO timestamps should bind without the trailing Z",
);

assert.equal(
  toClickHouseDateTime64("2026-08-15T13:30:00.000+07:00"),
  "2026-08-15 06:30:00.000",
  "offset timestamps should be normalized to UTC",
);

assert.equal(
  toClickHouseDateTime64("2026-08-15 06:30:00.000"),
  "2026-08-15 06:30:00.000",
  "existing ClickHouse UTC timestamps should remain stable",
);

assert.equal(
  toClickHouseDateTime64(new Date("2026-08-15T06:30:00.000Z")),
  "2026-08-15 06:30:00.000",
  "PostgreSQL Date values should bind without relying on string methods",
);

assert.throws(
  () => toClickHouseDateTime64("not-a-timestamp"),
  TypeError,
  "invalid timestamps should fail before a query is sent",
);

console.log("clickhouse datetime tests passed");
