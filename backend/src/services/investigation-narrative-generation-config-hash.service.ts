import { createHash } from "node:crypto";

import type {
  InvestigationNarrativeGenerationConfig,
  InvestigationNarrativeGenerationIdentity,
} from "../types/investigation-narrative-generation-config.js";

import { stableJsonStringify } from "./investigation-narrative-context-hash.service.js";

export function hashInvestigationNarrativeGenerationConfig(
  config: InvestigationNarrativeGenerationConfig,
): InvestigationNarrativeGenerationIdentity {
  const providerBaseUrl = normalizeProviderBaseUrl(config.providerBaseUrl);
  const systemPromptHash = sha256(config.systemPrompt);

  const hashInput = {
    model: config.model,
    outputContractVersion: config.outputContractVersion,
    promptVersion: config.promptVersion,
    providerBaseUrl,
    systemPromptHash,
  };

  return {
    generationConfigHash: sha256(stableJsonStringify(hashInput)),
    ...hashInput,
  };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeProviderBaseUrl(value: string): string {
  const url = new URL(value);

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  const normalized = url.toString();

  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
