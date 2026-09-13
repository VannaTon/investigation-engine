import {
  metricConsumerName,
  metricRecovery,
  metricStorageReadiness,
  metricWorker,
} from "../composition/metrics-worker.js";
import { connectRedis, redis } from "../config/redis.js";
import { isMetricRecoveryEnabled } from "../config/metric-recovery.js";

const SHUTDOWN_GRACE_MS = 15_000;

async function main(): Promise<void> {
  await connectRedis();
  const recoveryEnabled = isMetricRecoveryEnabled();

  console.log(
    JSON.stringify({
      event: "metric_worker_starting",
      consumer: metricConsumerName,
      recoveryEnabled,
    }),
  );

  if (recoveryEnabled) {
    const readiness = await metricStorageReadiness.assertReady();
    console.log(
      JSON.stringify({
        event: "metric_recovery_storage_ready",
        consumer: metricConsumerName,
        ...readiness,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        event: "metric_recovery_disabled",
        consumer: metricConsumerName,
      }),
    );
  }

  await metricWorker.initialize();

  console.log(
    JSON.stringify({
      event: "metric_worker_initialized",
      consumer: metricConsumerName,
    }),
  );

  const consumerTask = metricWorker.start();
  const recoveryTask = recoveryEnabled
    ? metricRecovery.start()
    : Promise.resolve();
  const workerTasks = Promise.all([consumerTask, recoveryTask]);
  let shutdownTask: Promise<void> | undefined;

  const performShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    const deadline = setTimeout(() => {
      console.error(
        JSON.stringify({
          event: "metric_worker_shutdown_deadline_exceeded",
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
          event: "metric_worker_shutdown_completed",
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
        event: "metric_worker_shutdown_started",
        signal,
        graceMs: SHUTDOWN_GRACE_MS,
      }),
    );
    metricWorker.stop();
    if (recoveryEnabled) {
      metricRecovery.stop();
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

main().catch(async (error) => {
  console.error(
    JSON.stringify({
      event: "metric_worker_crashed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  if (redis.isOpen) {
    redis.destroy();
  }
  process.exit(1);
});
