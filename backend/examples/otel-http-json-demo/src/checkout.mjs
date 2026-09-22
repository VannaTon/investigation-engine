import http from "node:http";
import { checkoutIncident } from "./checkout-incident.mjs";
import { context, metrics, trace } from "@opentelemetry/api";
import {
  logs,
  SeverityNumber,
} from "@opentelemetry/api-logs";

function readPort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(name + " must be a valid TCP port.");
  }

  return value;
}

const port = readPort("CHECKOUT_PORT", 41_002);
const unifiedRunToken = process.env.DEMO_UNIFIED_RUN_TOKEN;
const unifiedMetricName = process.env.DEMO_UNIFIED_METRIC_NAME;
const unifiedTelemetryEnabled =
  typeof unifiedRunToken === "string" &&
  unifiedRunToken.length > 0 &&
  typeof unifiedMetricName === "string" &&
  unifiedMetricName.length > 0;
const unifiedLogger = logs.getLogger(
  "otel-http-json-unified-demo",
  "1.0.0",
);
const checkoutFailureCounter = unifiedTelemetryEnabled
  ? metrics
      .getMeter("otel-http-json-unified-demo", "1.0.0")
      .createCounter(unifiedMetricName, {
        description: checkoutIncident.metricDescription,
        unit: "{failure}",
      })
  : undefined;

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (url.pathname !== "/checkout") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (url.searchParams.get("mode") === "error") {
    if (unifiedTelemetryEnabled) {
      const activeSpan = trace.getSpan(context.active());
      const activeSpanContext = activeSpan?.spanContext();
      const attributes = {
        "demo.run_token": unifiedRunToken,
        "demo.failure_kind": "inventory_unavailable",
      };

      checkoutFailureCounter?.add(1, attributes);
      unifiedLogger.emit({
        eventName: "phase7.demo.checkout.failure",
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: checkoutIncident.logMessage,
        attributes: {
          ...attributes,
          "exception.type": "InventoryUnavailableError",
          "exception.message": "inventory unavailable",
          "exception.stacktrace":
            "InventoryUnavailableError: inventory unavailable\n" +
            "    at checkout (checkout.mjs:1:1)",
        },
      });

      console.log(
        JSON.stringify({
          event: "unified_checkout_failure_recorded",
          runToken: unifiedRunToken,
          metricName: unifiedMetricName,
          traceId: activeSpanContext?.traceId,
          spanId: activeSpanContext?.spanId,
        }),
      );
    }

    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "inventory_unavailable" }));
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ checkout: "accepted" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      event: "demo_service_started",
      service: "demo-checkout",
      port,
    }),
  );
});

function shutdown(signal) {
  console.log(
    JSON.stringify({
      event: "demo_service_stopping",
      service: "demo-checkout",
      signal,
    }),
  );

  server.close(() => {
    process.exitCode = 0;
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
