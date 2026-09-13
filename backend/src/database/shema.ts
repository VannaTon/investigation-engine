import { clickhouse } from "../config/clickhouse.js";

export class SchemaInitializer {
  async initialize(): Promise<void> {
    console.log("Initializing ClickHouse schema...");

    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS logs
        (
            timestamp DateTime64(3),

            service LowCardinality(String),

            level LowCardinality(String),

            message String,

            stack_trace Nullable(String),

            trace_id Nullable(String),

            span_id Nullable(String),

            environment Nullable(String),

            metadata String,
            fingerprint String
        )
        ENGINE = MergeTree
        ORDER BY (timestamp, service);
      `,
    });

    console.log("Logs table ready.");
  }
}
