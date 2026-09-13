import assert from "node:assert/strict";
import {
  APPLICATION_STARTUP_TIMEOUT_MS,
  buildLocalProcessSpecs,
  findConflictingProcesses,
  INFRASTRUCTURE_STARTUP_TIMEOUT_MS,
  LOCAL_WORKER_INSTANCE_ID,
  missingRequiredLocalFlags,
  planInfrastructure,
  REQUIRED_LOCAL_RECOVERY_FLAGS,
} from "../scripts/local-dev-stack.js";
import { WORKER_INSTANCE_ID_ENV } from "../worker/consumer/consumer-name.js";

function main(): void {
  assert.equal(INFRASTRUCTURE_STARTUP_TIMEOUT_MS, 120_000);
  assert.equal(APPLICATION_STARTUP_TIMEOUT_MS, 90_000);

  const environment = Object.fromEntries(
    REQUIRED_LOCAL_RECOVERY_FLAGS.map((name) => [name, "true"]),
  );

  assert.deepEqual(missingRequiredLocalFlags(environment), []);
  assert.deepEqual(
    missingRequiredLocalFlags({
      ...environment,
      METRIC_RECOVERY_ENABLED: "false",
      LOG_RECOVERY_ENABLED: undefined,
    }),
    ["LOG_RECOVERY_ENABLED", "METRIC_RECOVERY_ENABLED"],
  );

  const specs = buildLocalProcessSpecs("/project/backend", environment);
  assert.deepEqual(
    specs.map((spec) => spec.name),
    [
      "api",
      "log-worker",
      "span-worker",
      "metric-worker",
      "histogram-worker",
      "frontend",
    ],
  );

  const api = specs.find((spec) => spec.name === "api");
  assert.deepEqual(api?.args, ["watch", "src/server.ts"]);

  const workers = specs.filter((spec) => spec.expectedConsumer !== undefined);
  assert.equal(workers.length, 4);
  for (const worker of workers) {
    assert.equal(
      worker.environment[WORKER_INSTANCE_ID_ENV],
      LOCAL_WORKER_INSTANCE_ID,
    );
    assert.equal(worker.args.includes("watch"), false);
    assert.equal(typeof worker.readyOutput, "string");
    assert.equal(
      worker.expectedConsumer?.name.endsWith("-" + LOCAL_WORKER_INSTANCE_ID),
      true,
    );
  }

  const frontend = specs.find((spec) => spec.name === "frontend");
  assert.equal(frontend?.cwd, "/project/frontend");
  assert.equal(frontend?.environment.VITE_DATA_SOURCE, "http");
  assert.equal(
    frontend?.environment.VITE_API_BASE_URL,
    "http://localhost:3000",
  );
  assert.deepEqual(frontend?.args.slice(1), [
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
    "--strictPort",
  ]);
  assert.equal(frontend?.args.includes("0.0.0.0"), false);
  assert.equal(
    specs.some((spec) => spec.args.includes("src/worker/alert-recovery.worker.ts")),
    false,
  );

  const conflicts = findConflictingProcesses(
    [
      "  101 node src/server.ts",
      "  102 node src/worker/metric.worker.ts",
      "  103 node src/scripts/local-dev-stack.ts",
      "  104 node harmless-script.ts",
      "  105 node /project/frontend/node_modules/vite/bin/vite.js --port 5173",
    ].join("\n"),
    new Set([102]),
  );
  assert.deepEqual(conflicts, [
    { pid: 101, command: "node src/server.ts" },
    {
      pid: 105,
      command:
        "node /project/frontend/node_modules/vite/bin/vite.js --port 5173",
    },
  ]);

  const allMissing = [
    { name: "observability-redis", exists: false, running: false },
    { name: "observability-clickhouse", exists: false, running: false },
    { name: "observability-postgres", exists: false, running: false },
  ];
  assert.deepEqual(planInfrastructure(allMissing), { action: "compose_up" });

  const allRunning = allMissing.map((state) => ({
    ...state,
    exists: true,
    running: true,
  }));
  assert.deepEqual(planInfrastructure(allRunning), { action: "reuse" });

  assert.deepEqual(
    planInfrastructure([
      allRunning[0]!,
      { ...allRunning[1]!, running: false },
      { ...allRunning[2]!, running: false },
    ]),
    {
      action: "start_existing",
      containerNames: ["observability-clickhouse", "observability-postgres"],
    },
  );

  assert.throws(
    () =>
      planInfrastructure([
        allRunning[0]!,
        allMissing[1]!,
        allRunning[2]!,
      ]),
    /partial observability infrastructure set/,
  );
}

main();
