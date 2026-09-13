import {
  logConsumerName,
  logRecovery,
  logStorageReadiness,
  logWorker,
} from "../composition/logs-worker.js";
import { isLogRecoveryEnabled } from "../config/log-recovery.js";
import { connectRedis } from "../config/redis.js";

export async function buildWorker() {
  await connectRedis();
  const recoveryEnabled = isLogRecoveryEnabled();

  console.log(
    JSON.stringify({
      event: "log_worker_starting",
      consumer: logConsumerName,
      recoveryEnabled,
    }),
  );

  if (recoveryEnabled) {
    const readiness = await logStorageReadiness.assertReady();
    console.log(
      JSON.stringify({
        event: "log_recovery_storage_ready",
        consumer: logConsumerName,
        ...readiness,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        event: "log_recovery_disabled",
        consumer: logConsumerName,
      }),
    );
  }

  await logWorker.initialize();

  console.log(
    JSON.stringify({
      event: "log_worker_initialized",
      consumer: logConsumerName,
    }),
  );

  const consumerTask = logWorker.start();
  const recoveryTask = recoveryEnabled
    ? logRecovery.start()
    : Promise.resolve();

  return {
    consumer: logWorker,
    consumerName: logConsumerName,
    recovery: logRecovery,
    recoveryEnabled,
    workerTasks: Promise.all([consumerTask, recoveryTask]),
  };
}
