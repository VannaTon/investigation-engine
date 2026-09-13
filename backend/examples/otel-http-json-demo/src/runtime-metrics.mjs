if (typeof globalThis.gc === "function") {
  globalThis.gc();
}


const keepAlive = setInterval(() => {
  // Runtime instrumentation observes this process automatically.
}, 1_000);

console.log(
  JSON.stringify({
    event: "runtime_metrics_demo_started",
    service: process.env.OTEL_SERVICE_NAME,
    pid: process.pid,
  }),
);

function shutdown(signal) {
  clearInterval(keepAlive);

  console.log(
    JSON.stringify({
      event: "runtime_metrics_demo_stopping",
      service: process.env.OTEL_SERVICE_NAME,
      signal,
    }),
  );

  process.exitCode = 0;

  // Leave a bounded window for the preloaded Node SDK's shutdown flush.
  setTimeout(() => {
    process.exit(0);
  }, 3_000);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
