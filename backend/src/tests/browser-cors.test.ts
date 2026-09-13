import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { browserCorsOptions } from "../config/browser-cors.js";

test("browser lifecycle PATCH preflight allows existing frontend origins and JSON", async () => {
  const app = Fastify();
  await app.register(cors, browserCorsOptions);
  let calls = 0;
  app.patch("/v1/alerts/:id/status", async () => { calls++; return { status: "acknowledged" }; });
  try {
    for (const origin of ["http://localhost:5173", "http://localhost:4173"]) {
      const response = await app.inject({
        method: "OPTIONS", url: "/v1/alerts/demo/status",
        headers: {
          origin,
          "access-control-request-method": "PATCH",
          "access-control-request-headers": "content-type",
        },
      });
      assert.equal(response.statusCode, 204);
      assert.equal(response.headers["access-control-allow-origin"], origin);
      assert.deepEqual(String(response.headers["access-control-allow-methods"]).split(",").map((value) => value.trim()), ["GET", "HEAD", "POST", "PATCH"]);
      assert.match(String(response.headers["access-control-allow-headers"]), /content-type/i);
    }
    assert.equal(calls, 0);
    const response = await app.inject({
      method: "PATCH", url: "/v1/alerts/demo/status",
      headers: { origin: "http://localhost:5173" }, payload: { status: "acknowledged" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5173");
    const denied = await app.inject({
      method: "OPTIONS", url: "/v1/alerts/demo/status",
      headers: { origin: "http://untrusted.example", "access-control-request-method": "PATCH" },
    });
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});
