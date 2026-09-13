import { parseAlertList } from "./alertListDataSource";
import type { InvestigationAlert } from "../types/investigation";

export type AlertAction = "acknowledged" | "resolved";
export interface AlertLifecycleDataSource {
  updateStatus(id: string, status: AlertAction, signal?: AbortSignal): Promise<InvestigationAlert>;
}

export class AlertLifecycleError extends Error {
  constructor(public readonly kind: "network" | "http" | "invalid", public readonly status?: number) {
    super("Alert update could not be confirmed.");
  }
}

export class HttpAlertLifecycleDataSource implements AlertLifecycleDataSource {
  constructor(private readonly baseUrl: string, private readonly fetchFn: typeof fetch = (...args) => fetch(...args)) {}

  async updateStatus(id: string, status: AlertAction, signal?: AbortSignal): Promise<InvestigationAlert> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, "")}/v1/alerts/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ status }), signal,
      });
    } catch {
      throw new AlertLifecycleError("network");
    }
    if (!response.ok) throw new AlertLifecycleError("http", response.status);
    try {
      const alert = parseAlertList([await response.json()])[0];
      if (!alert || alert.id !== id || alert.status !== status) throw new Error("Mismatched alert");
      return alert;
    } catch {
      throw new AlertLifecycleError("invalid");
    }
  }
}
