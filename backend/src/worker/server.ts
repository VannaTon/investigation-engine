import { redis } from "../config/redis.js";
import { buildWorker } from "./app.js";

const SHUTDOWN_GRACE_MS = 15_000;

async function main(): Promise<void> {
  const running = await buildWorker();
  let shutdownTask: Promise<void> | undefined;

  const performShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    const deadline = setTimeout(() => {
      console.error(
        JSON.stringify({
          event: "log_worker_shutdown_deadline_exceeded",
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
      await running.workerTasks;
      clearTimeout(deadline);

      if (redis.isOpen) {
        await redis.close();
      }

      console.log(
        JSON.stringify({
          event: "log_worker_shutdown_completed",
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
        event: "log_worker_shutdown_started",
        signal,
        graceMs: SHUTDOWN_GRACE_MS,
      }),
    );
    running.consumer.stop();
    if (running.recoveryEnabled) {
      running.recovery.stop();
    }
    shutdownTask = performShutdown(signal);
  };

  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));

  await running.workerTasks;

  if (shutdownTask !== undefined) {
    await shutdownTask;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "log_worker_crashed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  if (redis.isOpen) {
    redis.destroy();
  }
  process.exit(1);
});
