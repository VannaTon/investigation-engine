export interface InvestigationNarrativeGenerationConfig {
  providerBaseUrl: string;
  model: string;
  systemPrompt: string;
  promptVersion: string;
  outputContractVersion: string;
}

export interface InvestigationNarrativeGenerationIdentity {
  generationConfigHash: string;
  providerBaseUrl: string;
  model: string;
  systemPromptHash: string;
  promptVersion: string;
  outputContractVersion: string;
}
