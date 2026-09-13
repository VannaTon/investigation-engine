import { clickhouse } from "../config/clickhouse.js";
import {
  METRIC_REQUIRED_DEDUPLICATION_WINDOW,
  MetricStorageReadinessService,
} from "../services/metric-storage-readiness.service.js";

async function main(): Promise<void> {
  await clickhouse.command({
    query:
      "ALTER TABLE metrics MODIFY SETTING " +
      "non_replicated_deduplication_window = " +
      String(METRIC_REQUIRED_DEDUPLICATION_WINDOW),
  });

  const readiness = await new MetricStorageReadinessService().assertReady();

  console.log(
    JSON.stringify({
      event: "metric_recovery_storage_configured",
      ...readiness,
    }),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        event: "metric_recovery_storage_configuration_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await clickhouse.close();
  });
