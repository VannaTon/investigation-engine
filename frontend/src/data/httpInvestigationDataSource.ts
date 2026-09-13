import type {
  InvestigationDataSource,
  InvestigationRequestOptions,
} from "./investigationDataSource";
import {
  InvestigationHttpError,
  InvestigationNetworkError,
  InvestigationNotFoundError,
  InvalidInvestigationResponseError,
} from "./investigationErrors";
import { parseInvestigationResponse } from "./investigationResponse";

type FetchImplementation = typeof fetch;

export class HttpInvestigationDataSource implements InvestigationDataSource {
  private readonly apiBaseUrl: string;

  constructor(
    apiBaseUrl: string,
    private readonly fetchImplementation: FetchImplementation =
      (...args) => fetch(...args),
  ) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  }

  async getInvestigation(
    alertId: string,
    options: InvestigationRequestOptions = {},
  ) {
    const requestUrl =
      `${this.apiBaseUrl}/v1/alerts/${encodeURIComponent(alertId)}/investigation`;

    let response: Response;

    try {
      response = await this.fetchImplementation(requestUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: options.signal,
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      throw new InvestigationNetworkError(requestUrl);
    }

    if (response.status === 404) {
      throw new InvestigationNotFoundError(alertId);
    }

    if (!response.ok) {
      throw new InvestigationHttpError(response.status, requestUrl);
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      throw new InvalidInvestigationResponseError(
        "API response was not valid JSON",
      );
    }

    return parseInvestigationResponse(payload);
  }
}
