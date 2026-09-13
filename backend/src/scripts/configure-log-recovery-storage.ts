import { clickhouse } from "../config/clickhouse.js";
import {
  LOG_REQUIRED_DEDUPLICATION_WINDOW,
  LogStorageReadinessService,
} from "../services/log-storage-readiness.service.js";

async function main(): Promise<void> {
  await clickhouse.command({
    query:
      "ALTER TABLE logs MODIFY SETTING " +
      "non_replicated_deduplication_window = " +
      String(LOG_REQUIRED_DEDUPLICATION_WINDOW),
  });

  const readiness = await new LogStorageReadinessService().assertReady();

  console.log(
    JSON.stringify({
      event: "log_recovery_storage_configured",
      ...readiness,
    }),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        event: "log_recovery_storage_configuration_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await clickhouse.close();
  });
