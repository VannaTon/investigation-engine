import "dotenv/config";

import type { LlmProviderConfig } from "../types/llm-provider-config.js";

export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 180_000;

const MAX_LLM_REQUEST_TIMEOUT_MS = 2_147_483_647;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function loadLlmRequestTimeoutMs(): number {
  const value = process.env.LLM_REQUEST_TIMEOUT_MS?.trim();

  if (!value) {
    return DEFAULT_LLM_REQUEST_TIMEOUT_MS;
  }

  const milliseconds = Number(value);

  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds <= 0 ||
    milliseconds > MAX_LLM_REQUEST_TIMEOUT_MS
  ) {
    throw new Error(
      `LLM_REQUEST_TIMEOUT_MS must be a whole number between 1 and ${MAX_LLM_REQUEST_TIMEOUT_MS}`,
    );
  }

  return milliseconds;
}

export function loadLlmProviderConfig(): LlmProviderConfig {
  const baseUrl = requireEnv("LLM_BASE_URL");

  const model = requireEnv("LLM_MODEL");

  const apiKey = process.env.LLM_API_KEY?.trim();

  const requestTimeoutMs = loadLlmRequestTimeoutMs();

  return {
    baseUrl,
    model,
    requestTimeoutMs,

    ...(apiKey
      ? {
          apiKey,
        }
      : {}),
  };
}

export function hasLlmProviderConfig(): boolean {
  const baseUrl = process.env.LLM_BASE_URL?.trim();

  const model = process.env.LLM_MODEL?.trim();

  return Boolean(baseUrl && model);
}
