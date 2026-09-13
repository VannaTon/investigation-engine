import assert from "node:assert/strict";

import { postgres } from "../config/postgres.js";
import { InvestigationNarrativeSnapshotRepository } from "../repository/investigation-narrative-snapshot.repository.js";
import type { InvestigationNarrativeOutput } from "../types/investigation-narrative-output.js";

type CapturedQuery = {
  text: string;
  values: unknown[];
};

type QueryTarget = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: unknown[] }>;
};

const queryTarget = postgres as unknown as QueryTarget;
const originalQuery = queryTarget.query;
const capturedQueries: CapturedQuery[] = [];

const narrative: InvestigationNarrativeOutput = {
  summary: {
    text: "Grounded summary.",
    findingIds: ["finding:postgres"],
    signalIds: [],
  },
  candidates: [
    {
      candidateId: "candidate:postgres",
      text: "Grounded candidate explanation.",
      findingIds: ["finding:postgres"],
      signalIds: [],
    },
  ],
};

const storedRow = {
  evidence_cutoff: new Date("2026-08-15T06:30:00.000Z"),
  generated_at: new Date("2026-08-15T06:31:00.000Z"),
  context_hash:
    "1111111111111111111111111111111111111111111111111111111111111111",
  generation_config_hash:
    "2222222222222222222222222222222222222222222222222222222222222222",
  model: "model-a",
  provider_base_url: "https://provider-a.example/v1",
  system_prompt_hash:
    "3333333333333333333333333333333333333333333333333333333333333333",
  prompt_version: "investigation-narrative-prompt-v1",
  output_contract_version: "investigation-narrative-output-v1",
  narrative,
};

queryTarget.query = async (text, values = []) => {
  capturedQueries.push({
    text,
    values,
  });

  return {
    rows: [storedRow],
  };
};

try {
  const repository = new InvestigationNarrativeSnapshotRepository();
  const saved = await repository.save({
    alertId: "24afd0ec-1843-488c-9577-8b897eafd0c1",
    evidenceCutoff: "2026-08-15T06:30:00.000Z",
    generatedAt: "2026-08-15T06:31:00.000Z",
    contextHash: storedRow.context_hash,
    generationConfigHash: storedRow.generation_config_hash,
    model: storedRow.model,
    providerBaseUrl: storedRow.provider_base_url,
    systemPromptHash: storedRow.system_prompt_hash,
    promptVersion: storedRow.prompt_version,
    outputContractVersion: storedRow.output_contract_version,
    narrative,
  });

  assert.equal(saved.generationConfigHash, storedRow.generation_config_hash);
  assert.equal(saved.providerBaseUrl, storedRow.provider_base_url);

  const insertQuery = capturedQueries[0];

  assert.ok(insertQuery);

  const normalizedInsertSql = insertQuery.text.replace(/\s+/g, " ");

  assert.match(
    normalizedInsertSql,
    /ON CONFLICT \( alert_investigation_id, context_hash, generation_config_hash \)/,
  );
  assert.equal(insertQuery.values[4], storedRow.generation_config_hash);
  assert.equal(insertQuery.values.includes("secret-api-key"), false);

  const found = await repository.findByIdentity(
    "24afd0ec-1843-488c-9577-8b897eafd0c1",
    storedRow.context_hash,
    storedRow.generation_config_hash,
  );

  assert.ok(found);

  const lookupQuery = capturedQueries[1];

  assert.ok(lookupQuery);
  assert.deepEqual(lookupQuery.values, [
    "24afd0ec-1843-488c-9577-8b897eafd0c1",
    storedRow.context_hash,
    storedRow.generation_config_hash,
  ]);
  assert.match(
    lookupQuery.text.replace(/\s+/g, " "),
    /context_hash = \$2 AND narrative\.generation_config_hash = \$3/,
  );
} finally {
  queryTarget.query = originalQuery;
}

console.log("Investigation narrative snapshot repository tests passed.");
