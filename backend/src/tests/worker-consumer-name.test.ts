import assert from "node:assert/strict";
import {
  resolveConsumerName,
  WORKER_INSTANCE_ID_ENV,
} from "../worker/consumer/consumer-name.js";

function main(): void {
  assert.equal(resolveConsumerName("span-workers", {}, 1498), "span-workers-1498");

  assert.equal(
    resolveConsumerName(
      "span-workers",
      { [WORKER_INSTANCE_ID_ENV]: "local-dev" },
      1498,
    ),
    "span-workers-local-dev",
  );

  assert.equal(
    resolveConsumerName(
      "metric_workers",
      { [WORKER_INSTANCE_ID_ENV]: "  local_dev.1  " },
      1766,
    ),
    "metric_workers-local_dev.1",
  );

  assert.throws(
    () =>
      resolveConsumerName("log-workers", {
        [WORKER_INSTANCE_ID_ENV]: "   ",
      }),
    new RegExp(WORKER_INSTANCE_ID_ENV),
  );

  assert.throws(
    () =>
      resolveConsumerName("log-workers", {
        [WORKER_INSTANCE_ID_ENV]: "local dev",
      }),
    new RegExp(WORKER_INSTANCE_ID_ENV),
  );

  assert.throws(
    () =>
      resolveConsumerName("log-workers", {
        [WORKER_INSTANCE_ID_ENV]: "x".repeat(65),
      }),
    new RegExp(WORKER_INSTANCE_ID_ENV),
  );
}

main();
