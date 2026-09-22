import { clickhouse } from "../config/clickhouse.js";
import { initializeApplicationIdentityStorage } from "../database/application-identity-schema.js";

async function main(): Promise<void> {
  await initializeApplicationIdentityStorage();

  console.log(
    JSON.stringify({
      event: "application_identity_storage_configured",
      tables: [
        "logs",
        "spans",
        "metrics",
        "metric_histograms",
      ],
    }),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        event: "application_identity_storage_configuration_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await clickhouse.close();
  });
