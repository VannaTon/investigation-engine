import http from "node:http";
import { context, trace } from "@opentelemetry/api";

function readPort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(name + " must be a valid TCP port.");
  }

  return value;
}

const port = readPort("GATEWAY_PORT", 41_001);
const checkoutPort = readPort("CHECKOUT_PORT", 41_002);

function requestCheckout(mode) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        host: "127.0.0.1",
        port: checkoutPort,
        path: "/checkout?mode=" + encodeURIComponent(mode),
        method: "GET",
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => {
          body += chunk;
        });
        incoming.on("end", () => {
          resolve({
            statusCode: incoming.statusCode ?? 500,
            body,
          });
        });
      },
    );

    outgoing.setTimeout(3_000, () => {
      outgoing.destroy(new Error("Checkout request timed out."));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const activeSpan = trace.getSpan(context.active());
  const traceId = activeSpan?.spanContext().traceId;

  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (url.pathname !== "/demo") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const mode = url.searchParams.get("mode") === "error"
    ? "error"
    : "success";

  try {
    const checkout = await requestCheckout(mode);

    response.writeHead(checkout.statusCode >= 500 ? 502 : 200, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        traceId,
        mode,
        checkoutStatus: checkout.statusCode,
      }),
    );
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        traceId,
        mode,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      event: "demo_service_started",
      service: "demo-gateway",
      port,
    }),
  );
});

function shutdown(signal) {
  console.log(
    JSON.stringify({
      event: "demo_service_stopping",
      service: "demo-gateway",
      signal,
    }),
  );

  server.close(() => {
    process.exitCode = 0;
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
