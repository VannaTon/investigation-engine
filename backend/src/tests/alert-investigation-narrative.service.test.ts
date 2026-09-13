import assert from "node:assert/strict";

import type {
  InvestigationNarrativeSnapshotStore,
  SaveInvestigationNarrativeSnapshotInput,
  StoredInvestigationNarrativeSnapshot,
} from "../repository/investigation-narrative-snapshot.repository.js";
import {
  AlertInvestigationNarrativeService,
  InvestigationNarrativeCooldownError,
  type InvestigationNarrativeClock,
} from "../services/alert-investigation-narrative.service.js";
import {
  InvestigationNarrativeSemanticValidationError,
  InvestigationNarrativeService,
} from "../services/investigation-narrative.service.js";
import type { InvestigationNarrativeContext } from "../types/investigation-narrative-context.js";
import type { InvestigationNarrativeGenerator } from "../types/investigation-narrative-generator.js";
import type { InvestigationNarrativeGenerationConfig } from "../types/investigation-narrative-generation-config.js";
import type { InvestigationResponseV1 } from "../types/investigation-response.js";
import {
  createAlertInvestigationServiceFixture,
  createInvestigationResponseV1Fixture,
  investigationResponseV1AlertId,
  type InvestigationFixtureQueryLog,
} from "./fixtures/investigation-response-v1.fixture.js";

class CapturingFakeGenerator implements InvestigationNarrativeGenerator {
  readonly contexts: InvestigationNarrativeContext[] = [];

  async generate(context: InvestigationNarrativeContext): Promise<unknown> {
    this.contexts.push(structuredClone(context));

    const firstCandidate = context.candidates[0];

    if (!firstCandidate) {
      throw new Error("Expected at least one candidate");
    }

    const firstFindingId = firstCandidate.findingIds[0];

    if (!firstFindingId) {
      throw new Error("Expected candidate finding");
    }

    return {
      summary: {
        text: "Synthetic grounded investigation narrative.",
        findingIds: [firstFindingId],
        signalIds: [],
      },
      candidates: context.candidates.map((candidate) => {
        const findingId = candidate.findingIds[0];

        if (!findingId) {
          throw new Error(`Expected finding for ${candidate.candidateId}`);
        }

        return {
          candidateId: candidate.candidateId,
          text: `Grounded explanation for ${candidate.service}.`,
          findingIds: [findingId],
          signalIds: [],
        };
      }),
    };
  }
}

class MutableClock implements InvestigationNarrativeClock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class MutableInvestigationSource {
  readonly requestedCutoffs: string[] = [];

  constructor(public response: InvestigationResponseV1) {}

  async investigate(
    _alertId: string,
    cutoff: Date,
  ): Promise<InvestigationResponseV1> {
    this.requestedCutoffs.push(cutoff.toISOString());

    return structuredClone(this.response);
  }
}

type StoredRecord = StoredInvestigationNarrativeSnapshot & {
  alertId: string;
};

const baseGenerationConfig: InvestigationNarrativeGenerationConfig = {
  providerBaseUrl: "https://provider-a.example/v1",
  model: "model-a",
  systemPrompt: "Explain only deterministic evidence.",
  promptVersion: "investigation-narrative-prompt-v1",
  outputContractVersion: "investigation-narrative-output-v1",
};

class InMemorySnapshotStore implements InvestigationNarrativeSnapshotStore {
  readonly records: StoredRecord[] = [];
  latestGeneratedAtLookups = 0;

  async findByIdentity(
    alertId: string,
    contextHash: string,
    generationConfigHash: string,
  ): Promise<StoredInvestigationNarrativeSnapshot | null> {
    return (
      this.records.find(
        (record) =>
          record.alertId === alertId &&
          record.contextHash === contextHash &&
          record.generationConfigHash === generationConfigHash,
      ) ?? null
    );
  }

  async findLatestGeneratedAt(alertId: string): Promise<string | null> {
    this.latestGeneratedAtLookups += 1;

    return (
      this.records
        .filter((record) => record.alertId === alertId)
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]
        ?.generatedAt ?? null
    );
  }

  async save(
    input: SaveInvestigationNarrativeSnapshotInput,
  ): Promise<StoredInvestigationNarrativeSnapshot> {
    const existing = this.records.find(
      (record) =>
        record.alertId === input.alertId &&
        record.contextHash === input.contextHash &&
        record.generationConfigHash === input.generationConfigHash,
    );

    if (existing) {
      return existing;
    }

    const record: StoredRecord = {
      ...structuredClone(input),
    };

    this.records.push(record);

    return record;
  }
}

// One immutable cutoff is used by every deterministic evidence query.
{
  const queryLog: InvestigationFixtureQueryLog = {
    metricWindows: [],
    logWindows: [],
    traceWindows: [],
  };

  const investigationService =
    createAlertInvestigationServiceFixture(queryLog);

  const response = await investigationService.investigate(
    investigationResponseV1AlertId,
    new Date("2026-08-15T06:45:00.000Z"),
  );

  assert.equal(response.window.to, "2026-08-15T06:30:00.000Z");
  assert.deepEqual(queryLog.metricWindows, [response.window]);
  assert.deepEqual(queryLog.logWindows, [response.window]);
  assert.deepEqual(queryLog.traceWindows, [
    response.window,
    response.window,
  ]);
}

const generator = new CapturingFakeGenerator();
const narrativeService = new InvestigationNarrativeService(generator);
const source = new MutableInvestigationSource(
  await createInvestigationResponseV1Fixture(),
);
const snapshotStore = new InMemorySnapshotStore();
const clock = new MutableClock(new Date("2026-08-15T06:45:00.000Z"));

const service = new AlertInvestigationNarrativeService(
  source,
  narrativeService,
  snapshotStore,
  baseGenerationConfig,
  15_000,
  clock,
);

// First context generates, validates, persists, and returns a snapshot envelope.
const first = await service.generate(investigationResponseV1AlertId);

assert.equal(first.evidenceCutoff, "2026-08-15T06:30:00.000Z");
assert.equal(first.generatedAt, "2026-08-15T06:45:00.000Z");
assert.match(first.contextHash, /^[a-f0-9]{64}$/);
assert.equal(first.narrative.candidates.length, 3);
assert.equal("generationConfigHash" in first, false);
assert.equal(generator.contexts.length, 1);
assert.equal(snapshotStore.records.length, 1);

const firstContext = generator.contexts[0];

assert.ok(firstContext);
assert.deepEqual(
  firstContext.candidates.map((candidate) => candidate.service),
  ["postgres", "auth-service", "user-service"],
);
assert.deepEqual(
  firstContext.candidates.map((candidate) => candidate.rank),
  [1, 2, 3],
);
assert.deepEqual(
  firstContext.candidates.map((candidate) => candidate.tracePosition),
  ["observed_leaf_failure", "error_ancestor", "error_ancestor"],
);
assert.equal(
  firstContext.rankingRationale.allCandidatesSeverityTied,
  true,
);
assert.equal(firstContext.rankingRationale.commonSeverity, "high");
assert.deepEqual(
  firstContext.rankingRationale.comparisons.map(
    (comparison) => comparison.decisiveDimension,
  ),
  ["trace_position", "support_diversity"],
);

const authCpuTiming = firstContext.metricTimings.find(
  (timing) =>
    timing.service === "auth-service" && timing.metricName === "cpu_usage",
);

assert.ok(authCpuTiming);
assert.equal(authCpuTiming.observedMetricAnomalyDeltaMs, 12_778);
assert.deepEqual(
  first.narrative.candidates.map((candidate) => candidate.candidateId),
  firstContext.candidates.map((candidate) => candidate.candidateId),
);

// An identical hash is returned from persistence before the cooldown check.
const latestLookupsBeforeCache = snapshotStore.latestGeneratedAtLookups;
const cached = await service.generate(investigationResponseV1AlertId);

assert.deepEqual(cached, first);
assert.equal(generator.contexts.length, 1);
assert.equal(snapshotStore.records.length, 1);
assert.equal(
  snapshotStore.latestGeneratedAtLookups,
  latestLookupsBeforeCache,
);

// Cached narratives are revalidated at the application boundary.
const cachedRecord = snapshotStore.records[0];

assert.ok(cachedRecord);
const cachedNarrativeBeforeTamper = structuredClone(cachedRecord.narrative);
const semanticallyInvalidCachedNarrative = structuredClone(
  first.narrative,
);
semanticallyInvalidCachedNarrative.summary.text =
  "Postgres has the highest failure severity.";
cachedRecord.narrative = semanticallyInvalidCachedNarrative;

await assert.rejects(
  () => service.generate(investigationResponseV1AlertId),
  InvestigationNarrativeSemanticValidationError,
);

cachedRecord.narrative = cachedNarrativeBeforeTamper;

// Changed evidence with stable IDs produces a new hash and is cooldown-limited.
source.response = structuredClone(source.response);

const firstFinding = source.response.findings[0];

assert.ok(firstFinding);
firstFinding.message = `${firstFinding.message} (corrected fact)`;

await assert.rejects(
  () => service.generate(investigationResponseV1AlertId),
  (error: unknown) => {
    assert.ok(error instanceof InvestigationNarrativeCooldownError);
    assert.equal(error.retryAfterMs, 15_000);

    return true;
  },
);

assert.equal(generator.contexts.length, 1);
assert.equal(snapshotStore.records.length, 1);

clock.advance(15_000);

const changedEvidence = await service.generate(
  investigationResponseV1AlertId,
);

assert.notEqual(changedEvidence.contextHash, first.contextHash);
assert.equal(generator.contexts.length, 2);
assert.equal(snapshotStore.records.length, 2);

// A manual investigation-window edit changes the exact context and adds history.
source.response = structuredClone(source.response);
source.response.window = {
  from: "2026-08-15T05:40:00.000Z",
  to: "2026-08-15T06:30:00.000Z",
};

clock.advance(15_000);

const changedWindow = await service.generate(investigationResponseV1AlertId);

assert.notEqual(changedWindow.contextHash, changedEvidence.contextHash);
assert.equal(generator.contexts.length, 3);
assert.equal(snapshotStore.records.length, 3);

const cachedChangedWindow = await service.generate(
  investigationResponseV1AlertId,
);

assert.deepEqual(cachedChangedWindow, changedWindow);
assert.equal(generator.contexts.length, 3);
assert.equal(snapshotStore.records.length, 3);
assert.equal(source.requestedCutoffs.length, 7);

// Cache identity includes generation configuration while contextHash remains evidence-only.
{
  const configGenerator = new CapturingFakeGenerator();
  const configNarrativeService = new InvestigationNarrativeService(
    configGenerator,
  );
  const configSource = new MutableInvestigationSource(
    await createInvestigationResponseV1Fixture(),
  );
  const configStore = new InMemorySnapshotStore();
  const configClock = new MutableClock(
    new Date("2026-08-15T07:00:00.000Z"),
  );
  const secretApiKey = "must-never-be-persisted";
  const generationConfigWithSecret = {
    ...baseGenerationConfig,
    apiKey: secretApiKey,
  };

  const modelAService = new AlertInvestigationNarrativeService(
    configSource,
    configNarrativeService,
    configStore,
    generationConfigWithSecret,
    0,
    configClock,
  );

  const modelAFirst = await modelAService.generate(
    investigationResponseV1AlertId,
  );
  const modelARecord = configStore.records[0];

  assert.ok(modelARecord);
  assert.equal(modelARecord.model, "model-a");
  assert.match(modelARecord.generationConfigHash, /^[a-f0-9]{64}$/);

  configClock.advance(60_000);

  const modelACached = await modelAService.generate(
    investigationResponseV1AlertId,
  );

  assert.deepEqual(modelACached, modelAFirst);
  assert.equal(modelACached.generatedAt, modelAFirst.generatedAt);
  assert.equal(configGenerator.contexts.length, 1);
  assert.equal(configStore.records.length, 1);

  const modelBService = new AlertInvestigationNarrativeService(
    configSource,
    configNarrativeService,
    configStore,
    {
      ...baseGenerationConfig,
      model: "model-b",
    },
    0,
    configClock,
  );

  const modelB = await modelBService.generate(
    investigationResponseV1AlertId,
  );
  const modelBRecord = configStore.records[1];

  assert.ok(modelBRecord);
  assert.equal(modelB.contextHash, modelAFirst.contextHash);
  assert.notEqual(
    modelBRecord.generationConfigHash,
    modelARecord.generationConfigHash,
  );
  assert.equal(configGenerator.contexts.length, 2);
  assert.equal(configStore.records.length, 2);

  const providerBService = new AlertInvestigationNarrativeService(
    configSource,
    configNarrativeService,
    configStore,
    {
      ...baseGenerationConfig,
      providerBaseUrl: "https://provider-b.example/v1",
    },
    0,
    configClock,
  );

  const providerB = await providerBService.generate(
    investigationResponseV1AlertId,
  );
  const providerBRecord = configStore.records[2];

  assert.ok(providerBRecord);
  assert.equal(providerB.contextHash, modelAFirst.contextHash);
  assert.notEqual(
    providerBRecord.generationConfigHash,
    modelARecord.generationConfigHash,
  );
  assert.equal(configGenerator.contexts.length, 3);
  assert.equal(configStore.records.length, 3);

  const revisedPromptService = new AlertInvestigationNarrativeService(
    configSource,
    configNarrativeService,
    configStore,
    {
      ...baseGenerationConfig,
      systemPrompt: "Explain only deterministic evidence using policy v2.",
    },
    0,
    configClock,
  );

  const revisedPrompt = await revisedPromptService.generate(
    investigationResponseV1AlertId,
  );
  const revisedPromptRecord = configStore.records[3];

  assert.ok(revisedPromptRecord);
  assert.equal(revisedPrompt.contextHash, modelAFirst.contextHash);
  assert.notEqual(
    revisedPromptRecord.generationConfigHash,
    modelARecord.generationConfigHash,
  );
  assert.equal(configGenerator.contexts.length, 4);
  assert.equal(configStore.records.length, 4);

  const generationHashes = new Set(
    configStore.records.map((record) => record.generationConfigHash),
  );

  assert.equal(generationHashes.size, 4);
  assert.equal(
    JSON.stringify(configStore.records).includes(secretApiKey),
    false,
  );

  configSource.response = structuredClone(configSource.response);

  const changedConfigFinding = configSource.response.findings[0];

  assert.ok(changedConfigFinding);
  changedConfigFinding.message += " (new evidence)";

  const changedConfigEvidence = await modelAService.generate(
    investigationResponseV1AlertId,
  );

  assert.notEqual(changedConfigEvidence.contextHash, modelAFirst.contextHash);
  assert.equal(configGenerator.contexts.length, 5);
  assert.equal(configStore.records.length, 5);
}

// A different generation configuration is a new request and still observes cooldown.
{
  const cooldownGenerator = new CapturingFakeGenerator();
  const cooldownNarrativeService = new InvestigationNarrativeService(
    cooldownGenerator,
  );
  const cooldownSource = new MutableInvestigationSource(
    await createInvestigationResponseV1Fixture(),
  );
  const cooldownStore = new InMemorySnapshotStore();
  const cooldownClock = new MutableClock(
    new Date("2026-08-15T08:00:00.000Z"),
  );

  const cooldownModelAService = new AlertInvestigationNarrativeService(
    cooldownSource,
    cooldownNarrativeService,
    cooldownStore,
    baseGenerationConfig,
    15_000,
    cooldownClock,
  );

  await cooldownModelAService.generate(investigationResponseV1AlertId);

  const cooldownModelBService = new AlertInvestigationNarrativeService(
    cooldownSource,
    cooldownNarrativeService,
    cooldownStore,
    {
      ...baseGenerationConfig,
      model: "model-b",
    },
    15_000,
    cooldownClock,
  );

  await assert.rejects(
    () => cooldownModelBService.generate(investigationResponseV1AlertId),
    (error: unknown) => {
      assert.ok(error instanceof InvestigationNarrativeCooldownError);
      assert.equal(error.retryAfterMs, 15_000);

      return true;
    },
  );

  assert.equal(cooldownGenerator.contexts.length, 1);
  assert.equal(cooldownStore.records.length, 1);
}

// Concurrent identical requests converge on one persisted composite identity.
{
  const concurrentGenerator = new CapturingFakeGenerator();
  const concurrentNarrativeService = new InvestigationNarrativeService(
    concurrentGenerator,
  );
  const concurrentSource = new MutableInvestigationSource(
    await createInvestigationResponseV1Fixture(),
  );
  const concurrentStore = new InMemorySnapshotStore();
  const concurrentClock = new MutableClock(
    new Date("2026-08-15T09:00:00.000Z"),
  );
  const concurrentService = new AlertInvestigationNarrativeService(
    concurrentSource,
    concurrentNarrativeService,
    concurrentStore,
    baseGenerationConfig,
    0,
    concurrentClock,
  );

  const [concurrentFirst, concurrentSecond] = await Promise.all([
    concurrentService.generate(investigationResponseV1AlertId),
    concurrentService.generate(investigationResponseV1AlertId),
  ]);

  assert.deepEqual(concurrentSecond, concurrentFirst);
  assert.equal(concurrentStore.records.length, 1);
  assert.match(
    concurrentStore.records[0]?.generationConfigHash ?? "",
    /^[a-f0-9]{64}$/,
  );
}

console.log("Alert investigation narrative snapshot service tests passed.");
