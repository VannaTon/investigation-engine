import assert from "node:assert/strict";

import {
  GenericLlmNarrativeGenerator,
  GenericLlmNarrativeGeneratorError,
} from "../services/generic-llm-narrative-generator.service.js";

import {
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  loadLlmRequestTimeoutMs,
} from "../config/llm.js";

import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";

const context: InvestigationNarrativeContext = {
  alert: {
    id: "alert-1",
    title: "High CPU",
    message: "cpu_usage exceeded threshold",
    status: "resolved",
    service: "auth-service",
  },

  window: {
    from: "2026-08-15T05:50:00.000Z",
    to: "2026-08-15T06:30:00.000Z",
  },

  candidates: [
    {
      candidateId: "candidate:postgres",
      service: "postgres",
      rank: 1,
      tied: false,
      highestSeverity: "high",
      tracePosition: "observed_leaf_failure",
      supportDiversity: 4,
      failureFindingCount: 1,
      findingIds: ["finding:postgres"],
      signalIds: ["signal:trace-chain"],
      reasons: ["Highest failure severity: high", "Observed failing leaf span"],
    },
  ],

  rankingRationale: {
    candidateOrder: ["candidate:postgres"],
    allCandidatesSeverityTied: true,
    commonSeverity: "high",
    comparisons: [],
  },

  findings: [
    {
      findingId: "finding:postgres",
      type: "trace_error",
      severity: "high",
      timestamp: "2026-08-15T06:10:00.100Z",
      message: "Postgres trace error",
      service: "postgres",
    },
  ],

  signalTypes: ["trace_failure_chain"],

  metricTimings: [],
};

// --------------------------------------------------
// Case 1:
// Successful request sends correct config and
// decodes model JSON.
// --------------------------------------------------

{
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;

  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);

    requestedInit = init;

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: {
                  text: "Postgres has supported failure evidence.",

                  findingIds: ["finding:postgres"],

                  signalIds: ["signal:trace-chain"],
                },

                candidates: [
                  {
                    candidateId: "candidate:postgres",

                    text: "Postgres has high-severity trace failure evidence.",

                    findingIds: ["finding:postgres"],

                    signalIds: ["signal:trace-chain"],
                  },
                ],
              }),
            },
          },
        ],
      }),
      {
        status: 200,

        headers: {
          "content-type": "application/json",
        },
      },
    );
  };

  const generator = new GenericLlmNarrativeGenerator(
    {
      baseUrl: "https://example.test/v1",

      apiKey: "secret-key",

      model: "example-model",

      requestTimeoutMs: 1_000,
    },

    fakeFetch,
  );

  const result = await generator.generate(context);

  assert.equal(requestedUrl, "https://example.test/v1/chat/completions");

  assert.equal(requestedInit?.method, "POST");

  assert.ok(requestedInit?.signal instanceof AbortSignal);

  const headers = requestedInit?.headers as Record<string, string>;

  assert.equal(headers.authorization, "Bearer secret-key");

  assert.equal(headers["content-type"], "application/json");

  const body = JSON.parse(String(requestedInit?.body));

  assert.equal(body.model, "example-model");

  assert.equal(body.messages[0].role, "system");

  assert.equal(body.messages[1].role, "user");

  assert.deepEqual(result, {
    summary: {
      text: "Postgres has supported failure evidence.",

      findingIds: ["finding:postgres"],

      signalIds: ["signal:trace-chain"],
    },

    candidates: [
      {
        candidateId: "candidate:postgres",

        text: "Postgres has high-severity trace failure evidence.",

        findingIds: ["finding:postgres"],

        signalIds: ["signal:trace-chain"],
      },
    ],
  });
}

// --------------------------------------------------
// Case 2:
// API key is optional for local/self-hosted models.
// --------------------------------------------------

{
  let authorization: string | undefined;

  const fakeFetch: typeof fetch = async (_input, init) => {
    const headers = init?.headers as Record<string, string>;

    authorization = headers.authorization;

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: {
                  text: "Valid summary",

                  findingIds: ["finding:postgres"],

                  signalIds: [],
                },

                candidates: [
                  {
                    candidateId: "candidate:postgres",

                    text: "Valid candidate explanation",

                    findingIds: ["finding:postgres"],

                    signalIds: [],
                  },
                ],
              }),
            },
          },
        ],
      }),
      {
        status: 200,
      },
    );
  };

  const generator = new GenericLlmNarrativeGenerator(
    {
      baseUrl: "http://localhost:11434/v1",

      model: "local-model",

      requestTimeoutMs: 1_000,
    },

    fakeFetch,
  );

  await generator.generate(context);

  assert.equal(authorization, undefined);
}

// --------------------------------------------------
// Case 3:
// HTTP failure is surfaced.
// --------------------------------------------------

{
  const fakeFetch: typeof fetch = async () =>
    new Response("Unauthorized", {
      status: 401,
    });

  const generator = new GenericLlmNarrativeGenerator(
    {
      baseUrl: "https://example.test/v1",

      apiKey: "bad-key",

      model: "example-model",

      requestTimeoutMs: 1_000,
    },

    fakeFetch,
  );

  await assert.rejects(
    () => generator.generate(context),

    (error: unknown) => {
      assert.ok(error instanceof GenericLlmNarrativeGeneratorError);

      assert.equal(error.kind, "http");

      assert.equal(error.status, 401);

      return true;
    },
  );
}

// --------------------------------------------------
// Case 4:
// Provider response without choices is rejected.
// --------------------------------------------------

{
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [],
      }),
      {
        status: 200,
      },
    );

  const generator = new GenericLlmNarrativeGenerator(
    {
      baseUrl: "https://example.test/v1",

      model: "example-model",

      requestTimeoutMs: 1_000,
    },

    fakeFetch,
  );

  await assert.rejects(
    () => generator.generate(context),

    (error: unknown) => {
      assert.ok(error instanceof GenericLlmNarrativeGeneratorError);

      assert.equal(error.kind, "invalid_response");

      assert.match(error.message, /no choices/i);

      return true;
    },
  );
}

// --------------------------------------------------
// Case 5:
// Model content must itself be valid JSON.
// --------------------------------------------------

{
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "this is not json",
            },
          },
        ],
      }),
      {
        status: 200,
      },
    );

  const generator = new GenericLlmNarrativeGenerator(
    {
      baseUrl: "https://example.test/v1",

      model: "example-model",

      requestTimeoutMs: 1_000,
    },

    fakeFetch,
  );

  await assert.rejects(
    () => generator.generate(context),

    (error: unknown) => {
      assert.ok(error instanceof GenericLlmNarrativeGeneratorError);

      assert.equal(error.kind, "invalid_output");

      assert.match(error.message, /not valid JSON/i);

      return true;
    },
  );
}

// --------------------------------------------------
// Case 6:
// Transport failures are classified without leaking
// the underlying provider error.
// --------------------------------------------------

{
  const fakeFetch: typeof fetch = async () => {
    throw new TypeError("socket detail that must remain internal");
  };

  const generator = new GenericLlmNarrativeGenerator(
    {
      baseUrl: "https://example.test/v1",
      model: "example-model",
      requestTimeoutMs: 1_000,
    },
    fakeFetch,
  );

  await assert.rejects(
    () => generator.generate(context),
    (error: unknown) => {
      assert.ok(error instanceof GenericLlmNarrativeGeneratorError);
      assert.equal(error.kind, "network");
      assert.equal(error.status, undefined);
      assert.doesNotMatch(error.message, /socket detail/i);
      return true;
    },
  );
}

// --------------------------------------------------
// Case 7:
// Malformed provider HTTP JSON is an invalid
// response, not an unhandled server error.
// --------------------------------------------------

{
  const generator = new GenericLlmNarrativeGenerator(
    {
      baseUrl: "https://example.test/v1",
      model: "example-model",
      requestTimeoutMs: 1_000,
    },
    async () => new Response("not-json", { status: 200 }),
  );

  await assert.rejects(
    () => generator.generate(context),
    (error: unknown) => {
      assert.ok(error instanceof GenericLlmNarrativeGeneratorError);
      assert.equal(error.kind, "invalid_response");
      assert.match(error.message, /response body/i);
      return true;
    },
  );
}

// --------------------------------------------------
// Case 8:
// The configured deadline aborts one provider
// request and reports a typed timeout.
// --------------------------------------------------

{
  let fetchCalls = 0;

  const fakeFetch: typeof fetch = async (_input, init) => {
    fetchCalls += 1;

    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;

      assert.ok(signal);

      const testGuard = setTimeout(
        () => reject(new Error("Provider deadline did not abort the request")),
        1_000,
      );

      const rejectForAbort = () => {
        clearTimeout(testGuard);
        reject(signal.reason);
      };

      if (signal.aborted) {
        rejectForAbort();
        return;
      }

      signal.addEventListener("abort", rejectForAbort, { once: true });
    });
  };

  const generator = new GenericLlmNarrativeGenerator(
    {
      baseUrl: "https://example.test/v1",
      model: "example-model",
      requestTimeoutMs: 10,
    },
    fakeFetch,
  );

  await assert.rejects(
    () => generator.generate(context),
    (error: unknown) => {
      assert.ok(error instanceof GenericLlmNarrativeGeneratorError);
      assert.equal(error.kind, "timeout");
      assert.equal(error.timeoutMs, 10);
      return true;
    },
  );

  assert.equal(fetchCalls, 1);
}

// --------------------------------------------------
// Case 9:
// Timeout configuration has a slow-provider-safe
// default and rejects unsafe values.
// --------------------------------------------------

{
  const originalValue = process.env.LLM_REQUEST_TIMEOUT_MS;

  try {
    delete process.env.LLM_REQUEST_TIMEOUT_MS;
    assert.equal(
      loadLlmRequestTimeoutMs(),
      DEFAULT_LLM_REQUEST_TIMEOUT_MS,
    );

    process.env.LLM_REQUEST_TIMEOUT_MS = "240000";
    assert.equal(loadLlmRequestTimeoutMs(), 240_000);

    for (const invalidValue of ["0", "-1", "1.5", "not-a-number"]) {
      process.env.LLM_REQUEST_TIMEOUT_MS = invalidValue;
      assert.throws(
        () => loadLlmRequestTimeoutMs(),
        /LLM_REQUEST_TIMEOUT_MS/,
      );
    }
  } finally {
    if (originalValue === undefined) {
      delete process.env.LLM_REQUEST_TIMEOUT_MS;
    } else {
      process.env.LLM_REQUEST_TIMEOUT_MS = originalValue;
    }
  }
}

console.log("Generic LLM narrative generator tests passed.");
