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
      return "AI explanation is temporarily unavailable because the request timed out. Your evidence and ranking are still available.";
    case "NARRATIVE_PROVIDER_UNAVAILABLE":
      return "AI explanation is temporarily unavailable. Your evidence and ranking are still available.";
    case "NARRATIVE_PROVIDER_ERROR":
      return "AI explanation is temporarily unavailable. The AI service did not accept the request. Your evidence and ranking are still available.";
    case "NARRATIVE_PROVIDER_INVALID_RESPONSE":
      return "AI explanation is temporarily unavailable. The AI service sent a response we could not use. Your evidence and ranking are still available.";
    case "NARRATIVE_INVALID_OUTPUT":
      return "AI explanation is temporarily unavailable. The explanation was not in a usable format. Your evidence and ranking are still available.";
    case "NARRATIVE_GROUNDING_FAILED":
      return "The AI explanation was not shown because it could not be checked against this investigation's evidence. Your evidence and ranking are still available.";
    case "NARRATIVE_SEMANTIC_VALIDATION_FAILED":
      return "The AI explanation was not shown because it disagreed with the evidence-based ranking. Your evidence and ranking are still available.";
    case "NARRATIVE_GENERATION_COOLDOWN":
      return retryAfterSeconds !== undefined
        ? `An explanation was just created. Try again in ${retryAfterSeconds} seconds.`
        : "An explanation was just created. Try again shortly.";
    case "NARRATIVE_NOT_CONFIGURED":
      return "AI explanation is not set up. Your evidence and ranking are still available.";
    case "NARRATIVE_NETWORK_ERROR":
      return "AI explanation is temporarily unavailable. Your evidence and ranking are still available.";
    case "NARRATIVE_INVALID_RESPONSE":
      return "AI explanation is temporarily unavailable. We could not read the explanation response. Your evidence and ranking are still available.";
    case "NARRATIVE_HTTP_ERROR":
    case "UNKNOWN":
      return "AI explanation is temporarily unavailable. Your evidence and ranking are still available.";
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
