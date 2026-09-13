export class InvestigationNotFoundError extends Error {
  constructor(public readonly alertId: string) {
    super(`Investigation not found for alert "${alertId}".`);
    this.name = "InvestigationNotFoundError";
  }
}

export class InvestigationNetworkError extends Error {
  constructor(public readonly requestUrl: string) {
    super("Unable to reach the investigation API.");
    this.name = "InvestigationNetworkError";
  }
}

export class InvestigationHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly requestUrl: string,
  ) {
    super(`Investigation API request failed with status ${status}.`);
    this.name = "InvestigationHttpError";
  }
}

export class InvalidInvestigationResponseError extends Error {
  constructor(public readonly reason: string) {
    super(`Invalid investigation response: ${reason}`);
    this.name = "InvalidInvestigationResponseError";
  }
}
