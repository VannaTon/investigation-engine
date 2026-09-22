import { clickhouse } from "../config/clickhouse.js";
import { LOCAL_DEVELOPMENT_APPLICATION_ID } from "../types/application.js";
import { LOG_REQUIRED_DEDUPLICATION_WINDOW } from "../services/log-storage-readiness.service.js";
import { METRIC_REQUIRED_DEDUPLICATION_WINDOW } from "../services/metric-storage-readiness.service.js";
import { HISTOGRAM_METRIC_REQUIRED_DEDUPLICATION_WINDOW } from "../services/histogram-metric-storage-readiness.service.js";

const APPLICATION_COLUMN =
  "application_id UUID DEFAULT toUUID('" +
  LOCAL_DEVELOPMENT_APPLICATION_ID +
  "')";

async function createSignalTables(): Promise<void> {
  await clickhouse.command({
    query: [
      "CREATE TABLE IF NOT EXISTS logs",
      "(",
      "  " + APPLICATION_COLUMN + ",",
      "  timestamp DateTime64(3),",
      "  service LowCardinality(String),",
      "  level LowCardinality(String),",
      "  message String,",
      "  stack_trace Nullable(String),",
      "  trace_id Nullable(String),",
      "  span_id Nullable(String),",
      "  environment Nullable(String),",
      "  metadata String,",
      "  fingerprint String",
      ")",
      "ENGINE = MergeTree",
      "ORDER BY (application_id, timestamp, service)",
      "SETTINGS non_replicated_deduplication_window = " +
        String(LOG_REQUIRED_DEDUPLICATION_WINDOW),
    ].join("\n"),
  });

  await clickhouse.command({
    query: [
      "CREATE TABLE IF NOT EXISTS spans",
      "(",
      "  " + APPLICATION_COLUMN + ",",
      "  trace_id String,",
      "  span_id String,",
      "  parent_span_id Nullable(String),",
      "  service LowCardinality(String),",
      "  operation String,",
      "  start_time DateTime64(3),",
      "  end_time DateTime64(3),",
      "  duration_ms UInt32,",
      "  status LowCardinality(String),",
      "  metadata String",
      ")",
      "ENGINE = MergeTree",
      "ORDER BY (application_id, trace_id, start_time, span_id)",
    ].join("\n"),
  });

  await clickhouse.command({
    query: [
      "CREATE TABLE IF NOT EXISTS metrics",
      "(",
      "  " + APPLICATION_COLUMN + ",",
      "  timestamp DateTime64(3),",
      "  service LowCardinality(String),",
      "  name LowCardinality(String),",
      "  type LowCardinality(String),",
      "  value Float64,",
      "  unit Nullable(String),",
      "  metadata String",
      ")",
      "ENGINE = MergeTree",
      "ORDER BY (application_id, service, name, timestamp)",
      "SETTINGS non_replicated_deduplication_window = " +
        String(METRIC_REQUIRED_DEDUPLICATION_WINDOW),
    ].join("\n"),
  });

  await clickhouse.command({
    query: [
      "CREATE TABLE IF NOT EXISTS metric_histograms",
      "(",
      "  " + APPLICATION_COLUMN + ",",
      "  timestamp DateTime64(3),",
      "  service LowCardinality(String),",
      "  name LowCardinality(String),",
      "  temporality LowCardinality(String),",
      "  count UInt64,",
      "  sum Nullable(Float64),",
      "  min Nullable(Float64),",
      "  max Nullable(Float64),",
      "  bucket_counts Array(UInt64),",
      "  explicit_bounds Array(Float64),",
      "  unit Nullable(String),",
      "  metadata String,",
      "  stream_message_id String",
      ")",
      "ENGINE = MergeTree",
      "ORDER BY " +
        "(application_id, service, name, timestamp, stream_message_id)",
      "SETTINGS non_replicated_deduplication_window = " +
        String(HISTOGRAM_METRIC_REQUIRED_DEDUPLICATION_WINDOW),
    ].join("\n"),
  });
}

export async function initializeApplicationIdentityStorage(): Promise<void> {
  await createSignalTables();

  for (const table of [
    "logs",
    "spans",
    "metrics",
    "metric_histograms",
  ]) {
    await clickhouse.command({
      query:
        "ALTER TABLE " +
        table +
        " ADD COLUMN IF NOT EXISTS " +
        APPLICATION_COLUMN +
        " FIRST",
    });
  }
}
