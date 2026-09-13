import {
  logs,
  SeverityNumber,
} from "@opentelemetry/api-logs";

function requiredEnvironment(name) {
  const value = process.env[name];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(name + " is required.");
  }

  return value;
}

const service = requiredEnvironment("OTEL_SERVICE_NAME");
const runToken = requiredEnvironment("DEMO_LOG_RUN_TOKEN");
const logger = logs.getLogger(
  "otel-http-json-demo-logger",
  "1.0.0",
);
const infoMessage = "Phase 6C info " + runToken;
const errorMessage = "Phase 6C checkout failure " + runToken;
const stackTrace =
  "CheckoutError: inventory unavailable " +
  runToken +
  "\n    at checkout (runtime-logs.mjs:1:1)";

console.log(
  JSON.stringify({
    event: "runtime_logs_demo_started",
    service,
    runToken,
  }),
);

logger.emit({
  eventName: "phase6c.demo.info",
  severityNumber: SeverityNumber.INFO,
  severityText: "INFO",
  body: infoMessage,
  attributes: {
    "demo.run_token": runToken,
    "demo.record_kind": "info",
    "demo.nested": {
      verified: true,
      sequence: 1,
    },
  },
});

logger.emit({
  eventName: "phase6c.demo.error",
  severityNumber: SeverityNumber.ERROR,
  severityText: "ERROR",
  body: errorMessage,
  attributes: {
    "demo.run_token": runToken,
    "demo.record_kind": "error",
    "demo.nested": {
      verified: true,
      sequence: 2,
    },
    "exception.stacktrace": stackTrace,
  },
});

const keepAlive = setInterval(() => {
  // Keep the SDK alive until the verifier observes the batch export.
}, 1_000);

function shutdown(signal) {
  clearInterval(keepAlive);

  console.log(
    JSON.stringify({
      event: "runtime_logs_demo_stopping",
      service,
      runToken,
      signal,
    }),
  );

  process.exitCode = 0;

  setTimeout(() => {
    process.exit(0);
  }, 3_000);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
