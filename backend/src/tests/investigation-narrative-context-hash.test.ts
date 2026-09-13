import assert from "node:assert/strict";

import { buildNarrativeContext } from "../services/investigation-narrative-context.service.js";
import {
  hashInvestigationNarrativeContext,
  stableJsonStringify,
} from "../services/investigation-narrative-context-hash.service.js";
import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";
import { InvestigationCauseCandidateRankingService } from "../services/investigation-cause-candidate-ranking.service.js";
import { createInvestigationResponseV1Fixture } from "./fixtures/investigation-response-v1.fixture.js";

const context = buildNarrativeContext(
  await createInvestigationResponseV1Fixture(),
);

const reorderedProperties: InvestigationNarrativeContext = {
  metricTimings: context.metricTimings,
  signalTypes: context.signalTypes,
  findings: context.findings,
  rankingRationale: context.rankingRationale,
  candidates: context.candidates,
  window: {
    to: context.window.to,
    from: context.window.from,
  },
  alert: {
    status: context.alert.status,
    ...(context.alert.service
      ? {
          service: context.alert.service,
        }
      : {}),
    message: context.alert.message,
    title: context.alert.title,
    id: context.alert.id,
  },
};

assert.equal(
  stableJsonStringify(reorderedProperties),
  stableJsonStringify(context),
);
assert.equal(
  hashInvestigationNarrativeContext(reorderedProperties),
  hashInvestigationNarrativeContext(context),
);

const changedFact = structuredClone(context);
const firstFinding = changedFact.findings[0];

assert.ok(firstFinding);
firstFinding.message = `${firstFinding.message} (corrected)`;

assert.notEqual(
  hashInvestigationNarrativeContext(changedFact),
  hashInvestigationNarrativeContext(context),
);

const changedWindow = structuredClone(context);
changedWindow.window.from = "2026-08-15T05:40:00.000Z";

assert.notEqual(
  hashInvestigationNarrativeContext(changedWindow),
  hashInvestigationNarrativeContext(context),
);

const changedArrayOrder = structuredClone(context);
changedArrayOrder.candidates.reverse();

assert.notEqual(
  hashInvestigationNarrativeContext(changedArrayOrder),
  hashInvestigationNarrativeContext(context),
);

const repeatedContext = buildNarrativeContext(
  await createInvestigationResponseV1Fixture(),
);

assert.deepEqual(repeatedContext.rankingRationale, context.rankingRationale);
assert.equal(
  hashInvestigationNarrativeContext(repeatedContext),
  hashInvestigationNarrativeContext(context),
);

const changedRankingInvestigation =
  await createInvestigationResponseV1Fixture();
const changedPostgresFacts =
  changedRankingInvestigation.causeCandidateFacts.find(
    (facts) => facts.service === "postgres",
  );

assert.ok(changedPostgresFacts);
changedPostgresFacts.highestSeverity = "warning";
changedRankingInvestigation.causeCandidateRanks =
  new InvestigationCauseCandidateRankingService().createRanks(
    changedRankingInvestigation.causeCandidateFacts,
  );

const changedRankingContext = buildNarrativeContext(
  changedRankingInvestigation,
);

assert.notDeepEqual(
  changedRankingContext.rankingRationale,
  context.rankingRationale,
);
assert.notEqual(
  hashInvestigationNarrativeContext(changedRankingContext),
  hashInvestigationNarrativeContext(context),
);

console.log("Investigation narrative context hash tests passed.");
