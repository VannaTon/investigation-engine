import type { InvestigationAlert } from "../types/investigation";
import { parseTimestamp } from "../lib/formatters";

export class AlertListError extends Error {
  constructor(public readonly kind: "network" | "http" | "invalid", public readonly status?: number) {
    super(kind === "network" ? "We could not connect to the server. Check your connection and try again."
      : kind === "http" ? `The server could not load the alerts (error ${status}). Try again.`
      : "The server sent an alert list we could not use. Try again.");
  }
}

export function parseAlertList(payload: unknown): InvestigationAlert[] {
  if (!Array.isArray(payload)) throw new AlertListError("invalid");
  const ids = new Set<string>();
  for (const value of payload) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AlertListError("invalid");
    const row = value as Record<string, unknown>;
    for (const key of ["id", "ruleId", "title", "message", "startedAt", "createdAt", "updatedAt"]) {
      if (typeof row[key] !== "string") throw new AlertListError("invalid");
    }
    if (!(row.id as string).trim() || ids.has(row.id as string)) throw new AlertListError("invalid");
    ids.add(row.id as string);
    if (!["firing", "acknowledged", "resolved"].includes(row.status as string)) throw new AlertListError("invalid");
    if (row.service !== undefined && typeof row.service !== "string") throw new AlertListError("invalid");
    for (const key of ["startedAt", "createdAt", "updatedAt", "resolvedAt", "acknowledgedAt"]) {
      if (row[key] !== undefined && (typeof row[key] !== "string" || !Number.isFinite(parseTimestamp(row[key] as string).getTime()))) {
        throw new AlertListError("invalid");
      }
    }
  }
  return payload as InvestigationAlert[];
}

export interface AlertListDataSource {
  getAlerts(options?: { signal?: AbortSignal }): Promise<InvestigationAlert[]>;
}

export class HttpAlertListDataSource implements AlertListDataSource {
  constructor(private readonly baseUrl: string, private readonly fetchFn: typeof fetch = (...args) => fetch(...args)) {}

  async getAlerts({ signal }: { signal?: AbortSignal } = {}): Promise<InvestigationAlert[]> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, "")}/v1/alerts`, {
        headers: { Accept: "application/json" }, signal,
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      throw new AlertListError("network");
    }
    if (!response.ok) throw new AlertListError("http", response.status);
    let payload: unknown;
    try { payload = await response.json(); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw new AlertListError("invalid");
    }
    return parseAlertList(payload);
  }
}
