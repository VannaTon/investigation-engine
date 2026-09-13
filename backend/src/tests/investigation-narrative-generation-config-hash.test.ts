import assert from "node:assert/strict";

import { hashInvestigationNarrativeGenerationConfig } from "../services/investigation-narrative-generation-config-hash.service.js";
import type { InvestigationNarrativeGenerationConfig } from "../types/investigation-narrative-generation-config.js";

const baseConfig: InvestigationNarrativeGenerationConfig = {
  providerBaseUrl: "https://provider-a.example/v1/",
  model: "model-a",
  systemPrompt: "Explain only deterministic evidence.",
  promptVersion: "investigation-narrative-prompt-v1",
  outputContractVersion: "investigation-narrative-output-v1",
};

const first = hashInvestigationNarrativeGenerationConfig(baseConfig);
const unchanged = hashInvestigationNarrativeGenerationConfig({
  ...baseConfig,
});

assert.match(first.generationConfigHash, /^[a-f0-9]{64}$/);
assert.match(first.systemPromptHash, /^[a-f0-9]{64}$/);
assert.equal(first.providerBaseUrl, "https://provider-a.example/v1");
assert.equal(unchanged.generationConfigHash, first.generationConfigHash);

const changedModel = hashInvestigationNarrativeGenerationConfig({
  ...baseConfig,
  model: "model-b",
});

assert.notEqual(changedModel.generationConfigHash, first.generationConfigHash);

const changedProvider = hashInvestigationNarrativeGenerationConfig({
  ...baseConfig,
  providerBaseUrl: "https://provider-b.example/v1",
});

assert.notEqual(
  changedProvider.generationConfigHash,
  first.generationConfigHash,
);

const changedPrompt = hashInvestigationNarrativeGenerationConfig({
  ...baseConfig,
  systemPrompt: "Explain deterministic evidence using the revised policy.",
});

assert.notEqual(changedPrompt.generationConfigHash, first.generationConfigHash);

const changedPromptVersion = hashInvestigationNarrativeGenerationConfig({
  ...baseConfig,
  promptVersion: "investigation-narrative-prompt-v2",
});

assert.notEqual(
  changedPromptVersion.generationConfigHash,
  first.generationConfigHash,
);

const changedContract = hashInvestigationNarrativeGenerationConfig({
  ...baseConfig,
  outputContractVersion: "investigation-narrative-output-v2",
});

assert.notEqual(
  changedContract.generationConfigHash,
  first.generationConfigHash,
);

const configWithSecret = {
  ...baseConfig,
  apiKey: "must-never-enter-generation-identity",
};
const withSecret = hashInvestigationNarrativeGenerationConfig(configWithSecret);

assert.equal(withSecret.generationConfigHash, first.generationConfigHash);
assert.equal(
  JSON.stringify(withSecret).includes(configWithSecret.apiKey),
  false,
);

console.log("Investigation narrative generation config hash tests passed.");
