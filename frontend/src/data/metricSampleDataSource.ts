import { parseTimestamp } from "../lib/formatters";
import { requestRuleJson, RuleRequestError } from "./alertRuleDataSource";

export interface MetricSample {
  timestamp: string;
  service: string;
  name: string;
  type: string;
  value: number;
  unit?: string;
}

export interface MetricSampleResult {
  data: MetricSample[];
  hasMore: boolean;
}

export interface MetricSampleDataSource {
  recent(applicationId: string, service: string, name: string, signal?: AbortSignal): Promise<MetricSampleResult>;
}

export function parseMetricSampleResult(payload: unknown, service: string, name: string): MetricSampleResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new RuleRequestError("invalid_response");
  const result = payload as Record<string, unknown>;
  if (!Array.isArray(result.data) || result.data.length > 100 || typeof result.hasMore !== "boolean") throw new RuleRequestError("invalid_response");
  const data: MetricSample[] = result.data.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuleRequestError("invalid_response");
    const row = value as Record<string, unknown>;
    if (row.service !== service || row.name !== name || typeof row.type !== "string" || !row.type.trim()
      || typeof row.timestamp !== "string" || !Number.isFinite(parseTimestamp(row.timestamp).getTime())
      || typeof row.value !== "number" || !Number.isFinite(row.value)
      || (row.unit !== undefined && typeof row.unit !== "string")) throw new RuleRequestError("invalid_response");
    return { timestamp: row.timestamp, service, name, type: row.type, value: row.value,
      ...(row.unit === undefined ? {} : { unit: row.unit as string }) };
  });
  return { data, hasMore: result.hasMore };
}

export class HttpMetricSampleDataSource implements MetricSampleDataSource {
  constructor(private readonly apiBaseUrl: string, private readonly fetchFn: typeof fetch = (...args) => fetch(...args)) {}

  recent(applicationId: string, service: string, name: string, signal?: AbortSignal): Promise<MetricSampleResult> {
    if (typeof applicationId !== "string" || !applicationId.trim()
      || typeof service !== "string" || !service.trim() || typeof name !== "string" || !name.trim()) {
      throw new RuleRequestError("validation");
    }
    const now = Date.now();
    const query = new URLSearchParams({ applicationId, service, name, from: new Date(now - 15 * 60_000).toISOString(), to: new Date(now).toISOString(), limit: "100" });
    return requestRuleJson(this.fetchFn, `${this.apiBaseUrl.replace(/\/+$/, "")}/v1/metrics?${query}`, {
      headers: { Accept: "application/json" }, signal,
    }, (payload) => parseMetricSampleResult(payload, service, name));
  }
}
