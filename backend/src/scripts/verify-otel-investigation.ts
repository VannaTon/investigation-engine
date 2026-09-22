import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  compareInvestigationCauseCandidateRanks,
  INVESTIGATION_RANKING_DIMENSIONS,
} from "../services/investigation-cause-candidate-ranking-comparison.service.js";
import type { Alert } from "../types/alert.js";
import type { InvestigationCauseCandidateFacts } from "../types/investigation-cause-candidate-facts.js";
import type { InvestigationCauseCandidateRank } from "../types/investigation-cause-candidate-rank.js";
import type { InvestigationResponseV1 } from "../types/investigation-response.js";
import type { TraceNode } from "../types/trace-tree.js";

interface DemoResult {
  event: "otel_http_json_demo_verified";
  protocol: "http/json";
  compression: "none";
  successTraceId: string;
  successSpanCount: number;
  errorTraceId: string;
  errorSpanCount: number;
  pendingMessages: number;
}

interface VerificationIdentifiers {
  traceId: string;
  alertId: string;
  ruleId: string;
}

const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const demoDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../examples/otel-http-json-demo",
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const preserveInvestigation = process.argv.includes("--preserve");
let createdRuleId: string | undefined;

async function requestJson<T>(
  pathname: string,
  init: RequestInit = {},
  expectedStatus: number = 200,
): Promise<T> {
  const response = await fetch(backendUrl + pathname, init);
  const text = await response.text();
  let body: unknown;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (response.status !== expectedStatus) {
    throw new Error(
      (init.method ?? "GET") +
        " " +
        pathname +
        " returned HTTP " +
        response.status +
        ": " +
        text,
    );
  }

  return body as T;
}

async function runTelemetryDemo(): Promise<DemoResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ["run", "verify"], {
      cwd: demoDirectory,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: string[] = [];
    let result: DemoResult | undefined;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      reject(
        new Error(
          "OTLP demo exceeded 120 seconds.\n" + output.join("\n"),
        ),
      );
    }, 120_000);

    function record(line: string, channel: "stdout" | "stderr"): void {
      output.push(channel + ": " + line);

      if (channel === "stderr") {
        console.error(line);
        return;
      }

      console.log(line);

      try {
        const value = JSON.parse(line) as Partial<DemoResult>;

        if (value.event === "otel_http_json_demo_verified") {
          result = value as DemoResult;
        }
      } catch {
        // npm and child-service output is not required to be JSON.
      }
    }

    createInterface({ input: child.stdout }).on("line", (line) => {
      record(line, "stdout");
    });
    createInterface({ input: child.stderr }).on("line", (line) => {
      record(line, "stderr");
    });

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });

    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(
          new Error(
            "OTLP demo failed (code=" +
              String(code) +
              ", signal=" +
              String(signal) +
              ").\n" +
              output.join("\n"),
          ),
        );
        return;
      }

      if (result === undefined) {
        reject(
          new Error(
            "OTLP demo omitted its result.\n" + output.join("\n"),
          ),
        );
        return;
      }

      resolve(result);
    });
  });
}

function flattenTrace(nodes: TraceNode[]): TraceNode[] {
  const flattened: TraceNode[] = [];

  for (const node of nodes) {
    flattened.push(node, ...flattenTrace(node.children));
  }

  return flattened;
}

function validateErrorTrace(
  tree: TraceNode[],
  traceId: string,
): TraceNode[] {
  const spans = flattenTrace(tree);
  assert.equal(spans.length, 3);
  assert.equal(spans.every((span) => span.traceId === traceId), true);
  assert.equal(spans.every((span) => span.status === "error"), true);

  const checkout = spans.filter(
    (span) => span.service === "demo-checkout",
  );
  const gateway = spans.filter(
    (span) => span.service === "demo-gateway",
  );
  assert.equal(checkout.length, 1);
  assert.equal(gateway.length, 2);

  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const checkoutSpan = checkout[0]!;
  assert.ok(checkoutSpan.parentSpanId);

  const gatewayClient = byId.get(checkoutSpan.parentSpanId);
  assert.ok(gatewayClient);
  assert.equal(gatewayClient.service, "demo-gateway");
  assert.ok(gatewayClient.parentSpanId);

  const gatewayRoot = byId.get(gatewayClient.parentSpanId);
  assert.ok(gatewayRoot);
  assert.equal(gatewayRoot.service, "demo-gateway");
  assert.equal(gatewayRoot.parentSpanId, undefined);

  return spans;
}

function traceWindow(spans: TraceNode[]): {
  from: string;
  to: string;
} {
  const starts = spans.map((span) => new Date(span.startTime).getTime());
  const ends = spans.map((span) => new Date(span.endTime).getTime());
  assert.equal(starts.every(Number.isFinite), true);
  assert.equal(ends.every(Number.isFinite), true);

  return {
    from: new Date(Math.min(...starts)).toISOString(),
    to: new Date(Math.max(...ends) + 1).toISOString(),
  };
}

async function waitForAlert(ruleId: string): Promise<Alert> {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const alerts = await requestJson<Alert[]>("/v1/alerts");
    const alert = alerts.find((value) => value.ruleId === ruleId);

    if (alert !== undefined) {
      return alert;
    }

    await delay(250);
  }

  throw new Error(
    "No alert was created for rule " +
      ruleId +
      ". Ensure npm run metric-worker is running.",
  );
}

function oneByService<T extends { service: string }>(
  values: T[],
  service: string,
): T {
  const matches = values.filter((value) => value.service === service);
  assert.equal(matches.length, 1);
  return matches[0]!;
}

function projectFacts(facts: InvestigationCauseCandidateFacts) {
  return {
    service: facts.service,
    failureFindingCount: facts.failureFindingCount,
    logErrorCount: facts.logErrorCount,
    traceErrorCount: facts.traceErrorCount,
    highestSeverity: facts.highestSeverity,
    traceCount: facts.traceCount,
    correlationTypes: facts.correlationTypes,
    signalTypes: facts.signalTypes,
    supportDiversity: facts.supportDiversity,
    observedLeafErrorSpanCount: facts.observedLeafErrorSpanCount,
    observedErrorAncestorSpanCount:
      facts.observedErrorAncestorSpanCount,
  };
}

function verifyInvestigation(
  investigation: InvestigationResponseV1,
): {
  checkoutFacts: InvestigationCauseCandidateFacts;
  gatewayFacts: InvestigationCauseCandidateFacts;
  checkoutRank: InvestigationCauseCandidateRank;
  gatewayRank: InvestigationCauseCandidateRank;
} {
  assert.deepEqual(
    [...investigation.summary.servicesInvolved].sort(),
    ["demo-checkout", "demo-gateway"],
  );
  assert.equal(investigation.summary.errorSpans, 3);
  assert.equal(investigation.causeCandidates.length, 2);
  assert.equal(investigation.causeCandidateFacts.length, 2);
  assert.equal(investigation.causeCandidateRanks.length, 2);

  const checkoutFacts = oneByService(
    investigation.causeCandidateFacts,
    "demo-checkout",
  );
  const gatewayFacts = oneByService(
    investigation.causeCandidateFacts,
    "demo-gateway",
  );

  assert.deepEqual(projectFacts(checkoutFacts), {
    service: "demo-checkout",
    failureFindingCount: 1,
    logErrorCount: 0,
    traceErrorCount: 1,
    highestSeverity: "high",
    traceCount: 1,
    correlationTypes: ["same_trace"],
    signalTypes: [
      "cross_service_failure",
      "trace_failure_chain",
    ],
    supportDiversity: 3,
    observedLeafErrorSpanCount: 1,
    observedErrorAncestorSpanCount: 0,
  });
  assert.deepEqual(projectFacts(gatewayFacts), {
    service: "demo-gateway",
    failureFindingCount: 2,
    logErrorCount: 0,
    traceErrorCount: 2,
    highestSeverity: "high",
    traceCount: 1,
    correlationTypes: ["same_trace", "temporal_service"],
    signalTypes: [
      "cross_service_failure",
      "trace_failure_chain",
    ],
    supportDiversity: 4,
    observedLeafErrorSpanCount: 0,
    observedErrorAncestorSpanCount: 2,
  });

  assert.ok(gatewayFacts.supportDiversity > checkoutFacts.supportDiversity);
  assert.ok(
    gatewayFacts.failureFindingCount >
      checkoutFacts.failureFindingCount,
  );

  const checkoutRank = oneByService(
    investigation.causeCandidateRanks,
    "demo-checkout",
  );
  const gatewayRank = oneByService(
    investigation.causeCandidateRanks,
    "demo-gateway",
  );

  assert.equal(checkoutRank.candidateId, checkoutFacts.candidateId);
  assert.equal(gatewayRank.candidateId, gatewayFacts.candidateId);
  assert.equal(checkoutRank.severityRank, 2);
  assert.equal(gatewayRank.severityRank, 2);
  assert.equal(checkoutRank.tracePosition, "observed_leaf_failure");
  assert.equal(checkoutRank.tracePositionRank, 2);
  assert.equal(gatewayRank.tracePosition, "error_ancestor");
  assert.equal(gatewayRank.tracePositionRank, 1);
  assert.equal(checkoutRank.supportDiversity, checkoutFacts.supportDiversity);
  assert.equal(gatewayRank.supportDiversity, gatewayFacts.supportDiversity);
  assert.equal(
    checkoutRank.failureFindingCount,
    checkoutFacts.failureFindingCount,
  );
  assert.equal(
    gatewayRank.failureFindingCount,
    gatewayFacts.failureFindingCount,
  );

  assert.deepEqual(INVESTIGATION_RANKING_DIMENSIONS, [
    "failure_severity",
    "trace_position",
    "support_diversity",
    "failure_finding_count",
  ]);
  assert.deepEqual(
    compareInvestigationCauseCandidateRanks(checkoutRank, gatewayRank),
    {
      order: -1,
      decisiveDimension: "trace_position",
      dimensionsTiedBeforeDecision: ["failure_severity"],
    },
  );

  assert.equal(checkoutRank.rank, 1);
  assert.equal(checkoutRank.tied, false);
  assert.equal(gatewayRank.rank, 2);
  assert.equal(gatewayRank.tied, false);
  assert.equal(
    investigation.causeCandidateRanks[0]?.service,
    "demo-checkout",
  );

  return {
    checkoutFacts,
    gatewayFacts,
    checkoutRank,
    gatewayRank,
  };
}

async function deleteCreatedRule(): Promise<void> {
  if (createdRuleId === undefined) {
    return;
  }

  const ruleId = createdRuleId;
  const response = await fetch(
    backendUrl + "/v1/alert-rules/" + encodeURIComponent(ruleId),
    { method: "DELETE" },
  );

  if (response.status !== 204) {
    throw new Error(
      "Cleanup failed for rule " +
        ruleId +
        ": HTTP " +
        response.status +
        " " +
        (await response.text()),
    );
  }

  createdRuleId = undefined;
  console.log(
    JSON.stringify({
      event: "otel_investigation_demo_cleanup_completed",
      ruleId,
    }),
  );
}

async function verify(): Promise<VerificationIdentifiers> {
  await requestJson<unknown>("/health");

  const demo = await runTelemetryDemo();
  assert.equal(demo.protocol, "http/json");
  assert.equal(demo.compression, "none");
  assert.equal(demo.errorSpanCount, 3);
  assert.equal(demo.pendingMessages, 0);

  const tree = await requestJson<TraceNode[]>(
    "/v1/traces/" + encodeURIComponent(demo.errorTraceId),
  );
  const spans = validateErrorTrace(tree, demo.errorTraceId);
  const window = traceWindow(spans);
  const runId = randomUUID();
  const metricName = "otel_demo_failure_" + runId;

  const rule = await requestJson<{ id: string }>(
    "/v1/alert-rules",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Gateway request failure detected",
        type: "metric_threshold",
        enabled: true,
        config: {
          metricName,
          service: "demo-gateway",
          operator: ">=",
          threshold: 1,
          windowMinutes: 5,
          recoveryWindowMinutes: 5,
          stalenessMinutes: 5,
        },
      }),
    },
    201,
  );
  createdRuleId = rule.id;

  await requestJson<unknown>("/v1/metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "demo-gateway",
      name: metricName,
      type: "gauge",
      value: 1,
      metadata: {
        demoRunId: runId,
        traceId: demo.errorTraceId,
      },
    }),
  });

  const alert = await waitForAlert(rule.id);

  await requestJson<unknown>(
    "/v1/alerts/" +
      encodeURIComponent(alert.id) +
      "/investigation/window",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(window),
    },
  );

  const investigation = await requestJson<InvestigationResponseV1>(
    "/v1/alerts/" +
      encodeURIComponent(alert.id) +
      "/investigation",
  );
  const verified = verifyInvestigation(investigation);

  console.log(
    JSON.stringify({
      event: "otel_investigation_ranking_verified",
      traceId: demo.errorTraceId,
      alertId: alert.id,
      ruleId: rule.id,
      services: investigation.summary.servicesInvolved,
      errorSpans: investigation.summary.errorSpans,
      checkoutFacts: projectFacts(verified.checkoutFacts),
      gatewayFacts: projectFacts(verified.gatewayFacts),
      ranks: investigation.causeCandidateRanks,
      decisiveDimension: "trace_position",
      dimensionsTiedBeforeDecision: ["failure_severity"],
    }),
  );

  return {
    traceId: demo.errorTraceId,
    alertId: alert.id,
    ruleId: rule.id,
  };
}

async function main(): Promise<void> {
  let verificationError: unknown;
  let identifiers: VerificationIdentifiers | undefined;

  try {
    identifiers = await verify();
  } catch (error) {
    verificationError = error;
  }

  if (
    verificationError === undefined &&
    preserveInvestigation &&
    identifiers !== undefined
  ) {
    console.log(
      JSON.stringify({
        event: "otel_investigation_demo_preserved",
        ...identifiers,
      }),
    );
    return;
  }

  try {
    await deleteCreatedRule();
  } catch (cleanupError) {
    if (verificationError !== undefined) {
      throw new AggregateError(
        [verificationError, cleanupError],
        "Verification and cleanup both failed.",
      );
    }

    throw cleanupError;
  }

  if (verificationError !== undefined) {
    throw verificationError;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
