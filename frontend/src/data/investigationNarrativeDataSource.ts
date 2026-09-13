import {
  createNarrativeApiError,
} from "./investigationNarrativeErrors";
import {
  InvalidInvestigationNarrativeResponseError,
  parseInvestigationNarrativeSnapshot,
} from "./investigationNarrativeResponse";
import type {
  InvestigationNarrativeSnapshot,
  NarrativeApiErrorCode,
} from "../types/investigationNarrative";

type FetchImplementation = typeof fetch;
type JsonRecord = Record<string, unknown>;

export interface NarrativeRequestOptions {
  signal?: AbortSignal;
}

export interface InvestigationNarrativeDataSource {
  generateNarrative(
    alertId: string,
    options?: NarrativeRequestOptions,
  ): Promise<InvestigationNarrativeSnapshot>;
}

const backendErrorCodes = new Set<NarrativeApiErrorCode>([
  "NARRATIVE_PROVIDER_TIMEOUT",
  "NARRATIVE_PROVIDER_UNAVAILABLE",
  "NARRATIVE_PROVIDER_ERROR",
  "NARRATIVE_PROVIDER_INVALID_RESPONSE",
  "NARRATIVE_INVALID_OUTPUT",
  "NARRATIVE_GROUNDING_FAILED",
  "NARRATIVE_SEMANTIC_VALIDATION_FAILED",
  "NARRATIVE_GENERATION_COOLDOWN",
  "NARRATIVE_NOT_CONFIGURED",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseErrorPayload(payload: unknown): {
  code: NarrativeApiErrorCode;
  message?: string;
} {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return { code: "UNKNOWN" };
  }

  const code =
    typeof payload.error.code === "string" &&
    backendErrorCodes.has(payload.error.code as NarrativeApiErrorCode)
      ? (payload.error.code as NarrativeApiErrorCode)
      : "UNKNOWN";

  return {
    code,
    message:
      typeof payload.error.message === "string"
        ? payload.error.message
        : undefined,
  };
}

export function parseRetryAfter(
  value: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return undefined;

  return Math.max(0, Math.ceil((retryAt - nowMs) / 1_000));
}

export class HttpInvestigationNarrativeDataSource
  implements InvestigationNarrativeDataSource
{
  private readonly apiBaseUrl: string;

  constructor(
    apiBaseUrl: string,
    private readonly fetchImplementation: FetchImplementation =
      (...args) => fetch(...args),
  ) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  }

  async generateNarrative(
    alertId: string,
    options: NarrativeRequestOptions = {},
  ): Promise<InvestigationNarrativeSnapshot> {
    const requestUrl =
      `${this.apiBaseUrl}/v1/alerts/${encodeURIComponent(alertId)}/investigation/narrative`;

    let response: Response;

    try {
      response = await this.fetchImplementation(requestUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        signal: options.signal,
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      throw createNarrativeApiError("NARRATIVE_NETWORK_ERROR");
    }

    if (!response.ok) {
      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }

      const parsedError = parseErrorPayload(payload);
      const retryAfterSeconds = parseRetryAfter(
        response.headers.get("Retry-After"),
      );

      throw createNarrativeApiError(
        parsedError.code === "UNKNOWN"
          ? "NARRATIVE_HTTP_ERROR"
          : parsedError.code,
        response.status,
        retryAfterSeconds,
        parsedError.message,
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      throw createNarrativeApiError(
        "NARRATIVE_INVALID_RESPONSE",
        response.status,
      );
    }

    try {
      return parseInvestigationNarrativeSnapshot(payload);
    } catch (error: unknown) {
      if (error instanceof InvalidInvestigationNarrativeResponseError) {
        throw createNarrativeApiError(
          "NARRATIVE_INVALID_RESPONSE",
          response.status,
          undefined,
          error.reason,
        );
      }

      throw error;
    }
  }
}
