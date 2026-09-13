import { redis } from "../config/redis.js";
import { STREAMS, GROUPS } from "../constants/stream.js";
import { StreamConsumer } from "./consumer/stream.consumer.js";
import { StreamMessageHandler } from "./handler/stream-message.handler.js";
import { SpanProcessor } from "./processor/span.processor.js";
import { SpanRepository } from "../repository/span.repository.js";
import { connectRedis } from "../config/redis.js";
import { SpanRecoveryService } from "./recovery/span-recovery.service.js";
import { DlqPublisher } from "./publisher/dlq.publisher.js";
import { resolveConsumerName } from "./consumer/consumer-name.js";

const SHUTDOWN_GRACE_MS = 15_000;

async function main() {
  await connectRedis();
  console.log("Starting Span Worker...");
  const repository = new SpanRepository();

  const processor = new SpanProcessor(repository);
  const consumerName = resolveConsumerName(GROUPS.SPAN_WORKERS);

  const handler = new StreamMessageHandler(
    redis,
    STREAMS.SPANS,
    GROUPS.SPAN_WORKERS,
    processor,
  );

  const consumer = new StreamConsumer(
    redis,
    consumerName,
    STREAMS.SPANS,
    GROUPS.SPAN_WORKERS,
    handler,
  );

  const dlqPublisher = new DlqPublisher(redis);
  const recovery = new SpanRecoveryService(
    redis,
    handler,
    dlqPublisher,
    consumerName,
  );

  await consumer.initialize();

  console.log("Span Worker initialized.");

  const consumerTask = consumer.start();
  const recoveryTask = recovery.start();
  const workerTasks = Promise.all([consumerTask, recoveryTask]);
  let shutdownTask: Promise<void> | undefined;

  const performShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    const deadline = setTimeout(() => {
      console.error(
        JSON.stringify({
          event: "span_worker_shutdown_deadline_exceeded",
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
          event: "span_worker_shutdown_completed",
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
        event: "span_worker_shutdown_started",
        signal,
        graceMs: SHUTDOWN_GRACE_MS,
      }),
    );
    consumer.stop();
    recovery.stop();
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
      event: "span_worker_crashed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  if (redis.isOpen) {
    redis.destroy();
  }

  process.exit(1);
});
