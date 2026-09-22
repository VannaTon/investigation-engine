import "dotenv/config";

import {
  spawn,
  execFile,
  type ChildProcessByStdio,
} from "node:child_process";
import { open, readFile, unlink } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createClient } from "redis";
import { GROUPS, STREAMS } from "../constants/stream.js";
import { WORKER_INSTANCE_ID_ENV } from "../worker/consumer/consumer-name.js";

const execFileAsync = promisify(execFile);
const LOCAL_STACK_LOCK_PATH = "/tmp/observability-platform-local-dev-stack.lock";
export const INFRASTRUCTURE_STARTUP_TIMEOUT_MS = 120_000;
export const APPLICATION_STARTUP_TIMEOUT_MS = 90_000;
const SHUTDOWN_TIMEOUT_MS = 20_000;
const READINESS_POLL_MS = 250;

type LocalStartupStage = "infrastructure" | "applications";

export const LOCAL_WORKER_INSTANCE_ID = "local-dev";
export const REQUIRED_LOCAL_RECOVERY_FLAGS = [
  "LOG_RECOVERY_ENABLED",
  "METRIC_RECOVERY_ENABLED",
  "HISTOGRAM_METRIC_RECOVERY_ENABLED",
  "OTLP_EXPLICIT_HISTOGRAMS_ENABLED",
] as const;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultBackendDirectory = resolve(moduleDirectory, "../..");

export type LocalProcessSpec = {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  readyOutput?: string;
  expectedConsumer?: {
    stream: string;
    group: string;
    name: string;
  };
};

export type ConflictingProcess = {
  pid: number;
  command: string;
};

export type InfrastructureContainerState = {
  name: string;
  exists: boolean;
  running: boolean;
};

export type InfrastructurePlan =
  | { action: "compose_up" }
  | { action: "reuse" }
  | { action: "start_existing"; containerNames: string[] };

type ManagedProcess = {
  spec: LocalProcessSpec;
  child: PipedChildProcess;
  ready: Promise<void>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

type PipedChildProcess = ChildProcessByStdio<null, Readable, Readable>;

type StackStopReason =
  | { kind: "signal"; signal: NodeJS.Signals }
  | {
      kind: "unexpected_exit";
      processName: string;
      code: number | null;
      signal: NodeJS.Signals | null;
    };

const processMarkers = [
  "src/server.ts",
  "src/worker/server.ts",
  "src/worker/span.worker.ts",
  "src/worker/metric.worker.ts",
  "src/worker/histogram-metric.worker.ts",
  "node_modules/vite/bin/vite.js",
] as const;

const infrastructureContainerNames = [
  "observability-redis",
  "observability-clickhouse",
  "observability-postgres",
] as const;

export function missingRequiredLocalFlags(
  environment: NodeJS.ProcessEnv,
): string[] {
  return REQUIRED_LOCAL_RECOVERY_FLAGS.filter(
    (name) => environment[name] !== "true",
  );
}

export function buildLocalProcessSpecs(
  backendDirectory: string = defaultBackendDirectory,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): LocalProcessSpec[] {
  const frontendDirectory = resolve(backendDirectory, "../frontend");
  const tsxExecutable = resolve(backendDirectory, "node_modules/.bin/tsx");
  const localEnvironment = {
    ...baseEnvironment,
    INGESTION_AUTH_MODE:
      baseEnvironment.INGESTION_AUTH_MODE ?? "development",
  };
  const viteExecutable = resolve(
    frontendDirectory,
    "node_modules/vite/bin/vite.js",
  );
  const workerEnvironment = {
    ...localEnvironment,
    [WORKER_INSTANCE_ID_ENV]: LOCAL_WORKER_INSTANCE_ID,
  };
  const consumerName = (group: string): string =>
    group + "-" + LOCAL_WORKER_INSTANCE_ID;

  return [
    {
      name: "api",
      command: tsxExecutable,
      args: ["watch", "src/server.ts"],
      cwd: backendDirectory,
      environment: localEnvironment,
    },
    {
      name: "log-worker",
      command: tsxExecutable,
      args: ["src/worker/server.ts"],
      cwd: backendDirectory,
      environment: workerEnvironment,
      readyOutput: '"event":"log_worker_initialized"',
      expectedConsumer: {
        stream: STREAMS.LOGS,
        group: GROUPS.LOG_WORKERS,
        name: consumerName(GROUPS.LOG_WORKERS),
      },
    },
    {
      name: "span-worker",
      command: tsxExecutable,
      args: ["src/worker/span.worker.ts"],
      cwd: backendDirectory,
      environment: workerEnvironment,
      readyOutput: "Span Worker initialized.",
      expectedConsumer: {
        stream: STREAMS.SPANS,
        group: GROUPS.SPAN_WORKERS,
        name: consumerName(GROUPS.SPAN_WORKERS),
      },
    },
    {
      name: "metric-worker",
      command: tsxExecutable,
      args: ["src/worker/metric.worker.ts"],
      cwd: backendDirectory,
      environment: workerEnvironment,
      readyOutput: '"event":"metric_worker_initialized"',
      expectedConsumer: {
        stream: STREAMS.METRICS,
        group: GROUPS.METRIC_WORKERS,
        name: consumerName(GROUPS.METRIC_WORKERS),
      },
    },
    {
      name: "histogram-worker",
      command: tsxExecutable,
      args: ["src/worker/histogram-metric.worker.ts"],
      cwd: backendDirectory,
      environment: workerEnvironment,
      readyOutput: '"event":"histogram_metric_worker_initialized"',
      expectedConsumer: {
        stream: STREAMS.METRIC_HISTOGRAMS,
        group: GROUPS.METRIC_HISTOGRAM_WORKERS,
        name: consumerName(GROUPS.METRIC_HISTOGRAM_WORKERS),
      },
    },
    {
      name: "frontend",
      command: process.execPath,
      args: [
        viteExecutable,
        "--host",
        "127.0.0.1",
        "--port",
        "5173",
        "--strictPort",
      ],
      cwd: frontendDirectory,
      environment: {
        ...localEnvironment,
        VITE_DATA_SOURCE: "http",
        VITE_API_BASE_URL: "http://localhost:3000",
      },
    },
  ];
}

export function findConflictingProcesses(
  processTable: string,
  ignoredProcessIds: ReadonlySet<number> = new Set([process.pid]),
): ConflictingProcess[] {
  const conflicts: ConflictingProcess[] = [];

  for (const line of processTable.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match) {
      continue;
    }

    const pid = Number(match[1]);
    const command = match[2] ?? "";
    if (
      !Number.isSafeInteger(pid) ||
      ignoredProcessIds.has(pid) ||
      command.includes("local-dev-stack.ts")
    ) {
      continue;
    }

    if (processMarkers.some((marker) => command.includes(marker))) {
      conflicts.push({ pid, command });
    }
  }

  return conflicts;
}

export function planInfrastructure(
  states: InfrastructureContainerState[],
): InfrastructurePlan {
  if (states.length !== infrastructureContainerNames.length) {
    throw new Error("Infrastructure inspection returned an incomplete result.");
  }

  const existing = states.filter((state) => state.exists);
  if (existing.length === 0) {
    return { action: "compose_up" };
  }

  if (existing.length !== states.length) {
    throw new Error(
      "A partial observability infrastructure set exists: " +
        states
          .map((state) => state.name + "=" + (state.exists ? "present" : "missing"))
          .join(", "),
    );
  }

  const stopped = states.filter((state) => !state.running);
  if (stopped.length === 0) {
    return { action: "reuse" };
  }

  return {
    action: "start_existing",
    containerNames: stopped.map((state) => state.name),
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitUntil(
  description: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
  stage: LocalStartupStage,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      if (await check()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(READINESS_POLL_MS);
  }

  const detail =
    lastError instanceof Error ? ": " + lastError.message : "";
  throw new Error(
    "Timed out during " +
      stage +
      " startup after " +
      String(timeoutMs) +
      " ms while waiting for " +
      description +
      detail,
  );
}

async function waitForPromise(
  description: string,
  promise: Promise<void>,
  timeoutMs: number,
  stage: LocalStartupStage,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          "Timed out during " +
            stage +
            " startup after " +
            String(timeoutMs) +
            " ms while waiting for " +
            description,
        ),
      );
    }, timeoutMs);
  });

  try {
    await Promise.race([promise, timedOut]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolveAvailable, rejectUnavailable) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      rejectUnavailable(
        new Error("Port " + String(port) + " is already in use: " + error.message),
      );
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => {
        if (error) {
          rejectUnavailable(error);
          return;
        }
        resolveAvailable();
      });
    });
  });
}

async function canConnectToPort(port: number): Promise<boolean> {
  return new Promise<boolean>((resolveConnection) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolveConnection(connected);
    };

    socket.setTimeout(1_000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForInfrastructureReadiness(): Promise<void> {
  const startedAt = Date.now();
  await Promise.all([
    waitUntil(
      "Redis on port 6379",
      () => canConnectToPort(6379),
      INFRASTRUCTURE_STARTUP_TIMEOUT_MS,
      "infrastructure",
    ),
    waitUntil(
      "PostgreSQL on port 5432",
      () => canConnectToPort(5432),
      INFRASTRUCTURE_STARTUP_TIMEOUT_MS,
      "infrastructure",
    ),
    waitUntil("ClickHouse on port 8123", async () => {
      const response = await fetch("http://127.0.0.1:8123/ping", {
        signal: AbortSignal.timeout(1_000),
      });
      return response.ok;
    }, INFRASTRUCTURE_STARTUP_TIMEOUT_MS, "infrastructure"),
  ]);

  console.log(
    JSON.stringify({
      event: "local_dev_startup_stage_ready",
      stage: "infrastructure",
      elapsedMs: Date.now() - startedAt,
    }),
  );
}

async function acquireStackLock(): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(LOCAL_STACK_LOCK_PATH, "wx");
      await handle.writeFile(String(process.pid), "utf8");
      await handle.close();

      return async () => {
        try {
          const owner = (await readFile(LOCAL_STACK_LOCK_PATH, "utf8")).trim();
          if (owner === String(process.pid)) {
            await unlink(LOCAL_STACK_LOCK_PATH);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      const ownerText = await readFile(LOCAL_STACK_LOCK_PATH, "utf8").catch(
        () => "",
      );
      const ownerPid = Number(ownerText.trim());
      let ownerIsRunning = false;
      if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
        try {
          process.kill(ownerPid, 0);
          ownerIsRunning = true;
        } catch (ownerError) {
          if ((ownerError as NodeJS.ErrnoException).code === "EPERM") {
            ownerIsRunning = true;
          }
        }
      }

      if (ownerIsRunning) {
        throw new Error(
          "The local development stack is already running as PID " +
            String(ownerPid) +
            ".",
        );
      }

      await unlink(LOCAL_STACK_LOCK_PATH).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw unlinkError;
        }
      });
    }
  }

  throw new Error("Could not acquire the local development stack lock.");
}

function forwardOutput(
  child: PipedChildProcess,
  processName: string,
  onLine: (line: string) => void = () => undefined,
): void {
  const pipe = (
    source: NodeJS.ReadableStream,
    destination: NodeJS.WriteStream,
  ): void => {
    let buffered = "";
    source.setEncoding("utf8");
    source.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        onLine(line);
        destination.write("[" + processName + "] " + line + "\n");
      }
    });
    source.on("end", () => {
      if (buffered) {
        onLine(buffered);
        destination.write("[" + processName + "] " + buffered + "\n");
      }
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
}

function startManagedProcess(spec: LocalProcessSpec): ManagedProcess {
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolveProcessReady) => {
    resolveReady = resolveProcessReady;
  });
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.environment,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  forwardOutput(child, spec.name, (line) => {
    if (spec.readyOutput !== undefined && line.includes(spec.readyOutput)) {
      resolveReady();
    }
  });
  if (spec.readyOutput === undefined) {
    resolveReady();
  }
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit) => {
    child.once("error", (error) => {
      console.error(
        JSON.stringify({
          event: "local_dev_process_spawn_failed",
          processName: spec.name,
          error: error.message,
        }),
      );
      resolveExit({ code: 1, signal: null });
    });
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  return { spec, child, ready, exited };
}

async function runCommand(
  name: string,
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  forwardOutput(child, name);

  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  if (result.code !== 0) {
    throw new Error(
      name +
        " exited before completion (code=" +
        String(result.code) +
        ", signal=" +
        String(result.signal) +
        ").",
    );
  }
}

async function stopManagedProcesses(
  managedProcesses: ManagedProcess[],
): Promise<void> {
  for (const managed of managedProcesses) {
    const pid = managed.child.pid;
    if (pid !== undefined && managed.child.exitCode === null) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          throw error;
        }
      }
    }
  }

  const allExited = Promise.all(managedProcesses.map((managed) => managed.exited));
  const graceful = await Promise.race([
    allExited.then(() => true),
    delay(SHUTDOWN_TIMEOUT_MS).then(() => false),
  ]);

  if (graceful) {
    return;
  }

  for (const managed of managedProcesses) {
    const pid = managed.child.pid;
    if (pid !== undefined && managed.child.exitCode === null) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          throw error;
        }
      }
    }
  }

  await allExited;
}

async function waitForHttp(url: string): Promise<void> {
  await waitUntil(url, async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  }, APPLICATION_STARTUP_TIMEOUT_MS, "applications");
}

async function waitForWorkerConsumers(
  specs: LocalProcessSpec[],
): Promise<void> {
  const expectedConsumers = specs.flatMap((spec) =>
    spec.expectedConsumer ? [spec.expectedConsumer] : [],
  );
  const client = createClient({ url: "redis://127.0.0.1:6379" });
  client.on("error", () => undefined);

  await waitUntil("Redis", async () => {
    if (!client.isOpen) {
      await client.connect();
    }
    return client.isReady;
  }, APPLICATION_STARTUP_TIMEOUT_MS, "applications");

  try {
    for (const expected of expectedConsumers) {
      await waitUntil(expected.name, async () => {
        const consumers = await client.xInfoConsumers(
          expected.stream,
          expected.group,
        );
        return consumers.some((consumer) => consumer.name === expected.name);
      }, APPLICATION_STARTUP_TIMEOUT_MS, "applications");
    }
  } finally {
    if (client.isOpen) {
      await client.close();
    }
  }
}

async function readProcessTable(): Promise<string> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="]);
  return stdout;
}

async function inspectInfrastructure(): Promise<InfrastructureContainerState[]> {
  const states: InfrastructureContainerState[] = [];

  for (const name of infrastructureContainerNames) {
    try {
      const { stdout } = await execFileAsync("docker", [
        "inspect",
        "--format",
        "{{.State.Running}}",
        name,
      ]);
      states.push({ name, exists: true, running: stdout.trim() === "true" });
    } catch (error) {
      const stderr = String(
        (error as { stderr?: string | Buffer }).stderr ?? "",
      );
      if (stderr.includes("No such object")) {
        states.push({ name, exists: false, running: false });
        continue;
      }
      throw error;
    }
  }

  return states;
}

async function ensureInfrastructure(): Promise<void> {
  const plan = planInfrastructure(await inspectInfrastructure());

  if (plan.action === "reuse") {
    console.log(
      JSON.stringify({
        event: "local_dev_infrastructure_reused",
        containers: infrastructureContainerNames,
      }),
    );
    return;
  }

  if (plan.action === "start_existing") {
    await runCommand(
      "infrastructure",
      "docker",
      ["start", ...plan.containerNames],
      defaultBackendDirectory,
    );
    return;
  }

  await runCommand(
    "infrastructure",
    "docker",
    ["compose", "up", "-d"],
    defaultBackendDirectory,
  );
}

export async function runLocalDevStack(): Promise<void> {
  const releaseLock = await acquireStackLock();
  const managedProcesses: ManagedProcess[] = [];
  let shuttingDown = false;
  let resolveStop: (reason: StackStopReason) => void = () => undefined;
  const stopRequested = new Promise<StackStopReason>((resolveReason) => {
    resolveStop = resolveReason;
  });
  const onSigint = (): void => resolveStop({ kind: "signal", signal: "SIGINT" });
  const onSigterm = (): void =>
    resolveStop({ kind: "signal", signal: "SIGTERM" });

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const missingFlags = missingRequiredLocalFlags(process.env);
    if (missingFlags.length > 0) {
      throw new Error(
        "Required local recovery flags must equal true: " +
          missingFlags.join(", "),
      );
    }

    const conflicts = findConflictingProcesses(await readProcessTable());
    if (conflicts.length > 0) {
      throw new Error(
        "Existing local application processes must be stopped first: " +
          conflicts
            .map((conflict) =>
              String(conflict.pid) + " (" + conflict.command + ")",
            )
            .join("; "),
      );
    }

    await Promise.all([assertPortAvailable(3000), assertPortAvailable(5173)]);
    await ensureInfrastructure();
    await waitForInfrastructureReadiness();

    await runCommand(
      "postgres-migrations",
      "npm",
      ["run", "migrate:up"],
      defaultBackendDirectory,
    );
    await runCommand(
      "application-identity-storage",
      "npm",
      ["run", "configure:application-identity-storage"],
      defaultBackendDirectory,
    );

    const specs = buildLocalProcessSpecs();
    for (const spec of specs) {
      const managed = startManagedProcess(spec);
      managedProcesses.push(managed);
      void managed.exited.then(({ code, signal }) => {
        if (!shuttingDown) {
          resolveStop({
            kind: "unexpected_exit",
            processName: spec.name,
            code,
            signal,
          });
        }
      });
    }

    const applicationsStartedAt = Date.now();
    const readiness = Promise.all([
      waitForHttp("http://127.0.0.1:3000/health"),
      waitForHttp("http://127.0.0.1:5173/"),
      waitForWorkerConsumers(specs),
      ...managedProcesses.map((managed) =>
        waitForPromise(
          managed.spec.name + " readiness output",
          managed.ready,
          APPLICATION_STARTUP_TIMEOUT_MS,
          "applications",
        ),
      ),
    ]);
    const startupStop = stopRequested.then((reason) => {
      throw new Error(
        reason.kind === "unexpected_exit"
          ? reason.processName + " exited during startup."
          : "Startup interrupted by " + reason.signal + ".",
      );
    });
    await Promise.race([readiness, startupStop]);

    console.log(
      JSON.stringify({
        event: "local_dev_startup_stage_ready",
        stage: "applications",
        elapsedMs: Date.now() - applicationsStartedAt,
      }),
    );

    console.log(
      JSON.stringify({
        event: "local_dev_stack_ready",
        api: "http://127.0.0.1:3000",
        frontend: "http://127.0.0.1:5173",
        workerInstanceId: LOCAL_WORKER_INSTANCE_ID,
        alertRecoveryWorkerIncluded: false,
      }),
    );

    const reason = await stopRequested;
    shuttingDown = true;
    console.log(JSON.stringify({ event: "local_dev_stack_stopping", ...reason }));
    await stopManagedProcesses(managedProcesses);

    if (reason.kind === "unexpected_exit") {
      throw new Error(
        reason.processName +
          " exited unexpectedly (code=" +
          String(reason.code) +
          ", signal=" +
          String(reason.signal) +
          ").",
      );
    }

    console.log(
      JSON.stringify({
        event: "local_dev_stack_stopped",
        signal: reason.signal,
      }),
    );
  } catch (error) {
    shuttingDown = true;
    if (managedProcesses.length > 0) {
      await stopManagedProcesses(managedProcesses);
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await releaseLock();
  }
}

const directInvocation =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (directInvocation) {
  runLocalDevStack().catch((error) => {
    console.error(
      JSON.stringify({
        event: "local_dev_stack_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}
