import {
  histogramMetricConsumerName,
  histogramMetricRecovery,
  histogramMetricStorageReadiness,
  histogramMetricWorker,
} from "../composition/histogram-metrics-worker.js";
import { isHistogramMetricRecoveryEnabled } from "../config/histogram-metrics.js";
import { connectRedis, redis } from "../config/redis.js";

const SHUTDOWN_GRACE_MS = 15_000;

async function main(): Promise<void> {
  await connectRedis();
  const recoveryEnabled = isHistogramMetricRecoveryEnabled();

  console.log(
    JSON.stringify({
      event: "histogram_metric_worker_starting",
      consumer: histogramMetricConsumerName,
      recoveryEnabled,
    }),
  );

  if (recoveryEnabled) {
    const readiness =
      await histogramMetricStorageReadiness.assertReady();

    console.log(
      JSON.stringify({
        event: "histogram_metric_recovery_storage_ready",
        consumer: histogramMetricConsumerName,
        ...readiness,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        event: "histogram_metric_recovery_disabled",
        consumer: histogramMetricConsumerName,
      }),
    );
  }

  await histogramMetricWorker.initialize();

  console.log(
    JSON.stringify({
      event: "histogram_metric_worker_initialized",
      consumer: histogramMetricConsumerName,
    }),
  );

  const consumerTask = histogramMetricWorker.start();
  const recoveryTask = recoveryEnabled
    ? histogramMetricRecovery.start()
    : Promise.resolve();
  const workerTasks = Promise.all([consumerTask, recoveryTask]);
  let shutdownTask: Promise<void> | undefined;

  const performShutdown = async (
    signal: NodeJS.Signals,
  ): Promise<void> => {
    const deadline = setTimeout(() => {
      console.error(
        JSON.stringify({
          event: "histogram_metric_worker_shutdown_deadline_exceeded",
          signal,
          graceMs: SHUTDOWN_GRACE_MS,
        }),
      );
      if (redis.isOpen) {
        redis.destroy();
      }
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);

    try {
      await workerTasks;
      clearTimeout(deadline);

      if (redis.isOpen) {
        await redis.close();
      }

      console.log(
        JSON.stringify({
          event: "histogram_metric_worker_shutdown_completed",
          signal,
        }),
      );
    } catch (error) {
      clearTimeout(deadline);
      if (redis.isOpen) {
        redis.destroy();
      }
      throw error;
    }
  };

  const requestShutdown = (signal: NodeJS.Signals): void => {
    if (shutdownTask !== undefined) {
      return;
    }

    console.log(
      JSON.stringify({
        event: "histogram_metric_worker_shutdown_started",
        signal,
        graceMs: SHUTDOWN_GRACE_MS,
      }),
    );
    histogramMetricWorker.stop();
    if (recoveryEnabled) {
      histogramMetricRecovery.stop();
    }
    shutdownTask = performShutdown(signal);
  };

  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));

  await workerTasks;

  if (shutdownTask !== undefined) {
    await shutdownTask;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "histogram_metric_worker_crashed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  if (redis.isOpen) {
    redis.destroy();
  }
  process.exit(1);
});
