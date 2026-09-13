import assert from "node:assert/strict";

import { createInvestigationResponseV1Fixture } from "./fixtures/investigation-response-v1.fixture.js";

const result = await createInvestigationResponseV1Fixture();

const expectedKeys = [
  "alert",
  "window",
  "timeline",
  "metrics",
  "logs",
  "traces",
  "summary",
  "findings",
  "correlations",
  "evidenceGroups",
  "signals",
  "evidenceRanks",
  "integrityIssues",
  "causeCandidates",
  "causeCandidateFacts",
  "causeCandidateRanks",
].sort();

assert.deepEqual(Object.keys(result).sort(), expectedKeys);

assert.ok(result.alert);
assert.ok(result.window);

assert.ok(Array.isArray(result.findings));
assert.ok(Array.isArray(result.correlations));
assert.ok(Array.isArray(result.evidenceGroups));
assert.ok(Array.isArray(result.signals));

assert.ok(Array.isArray(result.causeCandidates));
assert.ok(Array.isArray(result.causeCandidateFacts));
assert.ok(Array.isArray(result.causeCandidateRanks));

console.log("Investigation response contract tests passed.");
