import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { HistogramMetricQueryError } from "../repository/histogram-metric.repository.js";
import { histogramMetricRoute } from "../routes/histogram-metric.routes.js";
import type { HistogramMetricQuery } from "../types/histogram-metric-query.js";

test("raw histogram query endpoint uses bounded typed filters", async () => {
  const queries: HistogramMetricQuery[] = [];
  const app = Fastify({ logger: false });

  await app.register(histogramMetricRoute, {
    queryService: {
      async find(query) {
        queries.push(query);
        return {
          data: [],
          hasMore: false,
        };
      },
    },
  });

  try {
    const response = await app.inject({
      method: "GET",
      url:
        "/v1/metric-histograms?service=checkout-service" +
        "&name=http.server.duration&limit=25",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      data: [],
      hasMore: false,
    });
    assert.deepEqual(queries.map((query) => ({ ...query })), [
      {
        service: "checkout-service",
        name: "http.server.duration",
        limit: 25,
      },
    ]);

    for (const limit of ["0", "101", "1.5"]) {
      const invalid = await app.inject({
        method: "GET",
        url: "/v1/metric-histograms?limit=" + limit,
      });
      assert.equal(invalid.statusCode, 400);
    }
  } finally {
    await app.close();
  }
});

test("invalid opaque cursors return a permanent 400 response", async () => {
  const app = Fastify({ logger: false });

  await app.register(histogramMetricRoute, {
    queryService: {
      async find() {
        throw new HistogramMetricQueryError(
          "Histogram metric cursor is invalid.",
        );
      },
    },
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/metric-histograms?cursor=invalid",
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      statusCode: 400,
      error: "Bad Request",
      message: "Histogram metric cursor is invalid.",
    });
  } finally {
    await app.close();
  }
});
