import {
  NarrativeApiError,
  type NarrativeApiErrorCode,
} from "../types/investigationNarrative";

export function narrativeErrorMessage(
  code: NarrativeApiErrorCode,
  retryAfterSeconds?: number,
): string {
  switch (code) {
    case "NARRATIVE_PROVIDER_TIMEOUT":
      return "The AI explanation request timed out. Your deterministic investigation is still available.";
    case "NARRATIVE_PROVIDER_UNAVAILABLE":
      return "AI explanation is temporarily unavailable. Your deterministic investigation is still available.";
    case "NARRATIVE_PROVIDER_ERROR":
      return "The AI provider rejected the explanation request. Your deterministic investigation is still available.";
    case "NARRATIVE_PROVIDER_INVALID_RESPONSE":
      return "The AI provider returned an invalid response. Your deterministic investigation is still available.";
    case "NARRATIVE_INVALID_OUTPUT":
      return "The AI returned an invalid explanation. Your deterministic investigation is still available.";
    case "NARRATIVE_GROUNDING_FAILED":
      return "The generated explanation could not be verified against the investigation evidence.";
    case "NARRATIVE_SEMANTIC_VALIDATION_FAILED":
      return "The generated explanation conflicted with deterministic ranking facts and was rejected.";
    case "NARRATIVE_GENERATION_COOLDOWN":
      return retryAfterSeconds !== undefined
        ? `A fresh explanation was just generated. Try again in ${retryAfterSeconds} seconds.`
        : "A fresh explanation was just generated. Try again shortly.";
    case "NARRATIVE_NOT_CONFIGURED":
      return "AI explanation is not configured. Your deterministic investigation is still available.";
    case "NARRATIVE_NETWORK_ERROR":
      return "AI explanation is temporarily unavailable. Your deterministic investigation is still available.";
    case "NARRATIVE_INVALID_RESPONSE":
      return "The AI explanation response could not be read. Your deterministic investigation is still available.";
    case "NARRATIVE_HTTP_ERROR":
    case "UNKNOWN":
      return "AI explanation is temporarily unavailable. Your deterministic investigation is still available.";
  }
}

export function createNarrativeApiError(
  code: NarrativeApiErrorCode,
  status?: number,
  retryAfterSeconds?: number,
  backendMessage?: string,
): NarrativeApiError {
  return new NarrativeApiError(
    code,
    narrativeErrorMessage(code, retryAfterSeconds),
    status,
    retryAfterSeconds,
    backendMessage,
  );
}

export function normalizeNarrativeApiError(error: unknown): NarrativeApiError {
  return error instanceof NarrativeApiError
    ? error
    : createNarrativeApiError("UNKNOWN");
}
