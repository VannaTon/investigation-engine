import { clickhouse } from "../config/clickhouse.js";
import {
  HISTOGRAM_METRIC_REQUIRED_DEDUPLICATION_WINDOW,
  HistogramMetricStorageReadinessService,
} from "../services/histogram-metric-storage-readiness.service.js";

async function main(): Promise<void> {
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS metric_histograms
      (
        timestamp DateTime64(3),
        service LowCardinality(String),
        name LowCardinality(String),
        temporality LowCardinality(String),
        count UInt64,
        sum Nullable(Float64),
        min Nullable(Float64),
        max Nullable(Float64),
        bucket_counts Array(UInt64),
        explicit_bounds Array(Float64),
        unit Nullable(String),
        metadata String,
        stream_message_id String
      )
      ENGINE = MergeTree
      ORDER BY (service, name, timestamp, stream_message_id)
      SETTINGS non_replicated_deduplication_window =
        ${String(HISTOGRAM_METRIC_REQUIRED_DEDUPLICATION_WINDOW)}
    `,
  });

  await clickhouse.command({
    query:
      "ALTER TABLE metric_histograms MODIFY SETTING " +
      "non_replicated_deduplication_window = " +
      String(HISTOGRAM_METRIC_REQUIRED_DEDUPLICATION_WINDOW),
  });

  const readiness =
    await new HistogramMetricStorageReadinessService().assertReady();

  console.log(
    JSON.stringify({
      event: "histogram_metric_storage_configured",
      table: "metric_histograms",
      ...readiness,
    }),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        event: "histogram_metric_storage_configuration_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await clickhouse.close();
  });
