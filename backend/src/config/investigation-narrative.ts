import { loadLlmProviderConfig } from "./llm.js";

import { GenericLlmNarrativeGenerator } from "../services/generic-llm-narrative-generator.service.js";

import { InvestigationNarrativeService } from "../services/investigation-narrative.service.js";

import { AlertInvestigationNarrativeService } from "../services/alert-investigation-narrative.service.js";

import type { AlertInvestigationService } from "../services/alert-investigation.service.js";

import { InvestigationNarrativeSnapshotRepository } from "../repository/investigation-narrative-snapshot.repository.js";

import type { LlmProviderConfig } from "../types/llm-provider-config.js";

import { INVESTIGATION_NARRATIVE_SYSTEM_PROMPT } from "../prompts/investigation-narrative.system.js";

import { INVESTIGATION_NARRATIVE_PROMPT_VERSION } from "../services/investigation-narrative-prompt.service.js";

import { INVESTIGATION_NARRATIVE_OUTPUT_CONTRACT_VERSION } from "../types/investigation-narrative-output.js";

export const DEFAULT_INVESTIGATION_NARRATIVE_COOLDOWN_MS = 15_000;

export function createInvestigationNarrativeService(
  config: LlmProviderConfig = loadLlmProviderConfig(),
): InvestigationNarrativeService {
  const generator = new GenericLlmNarrativeGenerator(config);

  return new InvestigationNarrativeService(generator);
}

export function createAlertInvestigationNarrativeService(
  investigationService: AlertInvestigationService,
): AlertInvestigationNarrativeService {
  const providerConfig = loadLlmProviderConfig();

  return new AlertInvestigationNarrativeService(
    investigationService,
    createInvestigationNarrativeService(providerConfig),
    new InvestigationNarrativeSnapshotRepository(),
    {
      providerBaseUrl: providerConfig.baseUrl,
      model: providerConfig.model,
      systemPrompt: INVESTIGATION_NARRATIVE_SYSTEM_PROMPT,
      promptVersion: INVESTIGATION_NARRATIVE_PROMPT_VERSION,
      outputContractVersion:
        INVESTIGATION_NARRATIVE_OUTPUT_CONTRACT_VERSION,
    },
    loadInvestigationNarrativeCooldownMs(),
  );
}

export function loadInvestigationNarrativeCooldownMs(): number {
  const value = process.env.INVESTIGATION_NARRATIVE_COOLDOWN_SECONDS?.trim();

  if (!value) {
    return DEFAULT_INVESTIGATION_NARRATIVE_COOLDOWN_MS;
  }

  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(
      "INVESTIGATION_NARRATIVE_COOLDOWN_SECONDS must be a non-negative number",
    );
  }

  return seconds * 1_000;
}
