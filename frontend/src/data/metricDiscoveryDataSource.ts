import { requestRuleJson, RuleRequestError } from "./alertRuleDataSource";

export interface DiscoveryWindow {
  from: string;
  to: string;
}

export interface ServiceDiscoveryResult {
  data: string[];
  hasMore: boolean;
  window: DiscoveryWindow;
}

export interface MetricDiscoveryDescriptor {
  name: string;
  types: string[];
  units: string[];
  lastSeen: string;
  metadataTruncated: boolean;
}

export interface MetricDiscoveryResult {
  service: string;
  data: MetricDiscoveryDescriptor[];
  hasMore: boolean;
  window: DiscoveryWindow;
}

export interface MetricDiscoveryDataSource {
  services(applicationId: string, signal?: AbortSignal): Promise<ServiceDiscoveryResult>;
  metrics(applicationId: string, service: string, signal?: AbortSignal): Promise<MetricDiscoveryResult>;
}

const RESULT_LIMIT = 200;
const METADATA_LIMIT = 20;
const IDENTITY_LIMIT = 512;
const DISCOVERY_WINDOW_MS = 24 * 60 * 60_000;

function invalid(): never {
  throw new RuleRequestError("invalid_response");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function identity(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= IDENTITY_LIMIT;
}

// Discovery uses UTC ISO timestamps, not locale-dependent dates. Verify calendar
// components as Date otherwise normalizes impossible dates such as February 30.
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) invalid();
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (!Number.isFinite(time) || parsed.toISOString().slice(0, 19) !== value.slice(0, 19)) invalid();
  return time;
}

function parseWindow(value: unknown): DiscoveryWindow {
  if (!record(value)) invalid();
  const from = timestamp(value.from);
  const to = timestamp(value.to);
  // A one-second allowance accommodates timestamp precision, without requiring
  // exact duration equality or depending on the browser and server clocks.
  if (from >= to || to - from > DISCOVERY_WINDOW_MS + 1_000) invalid();
  return { from: value.from as string, to: value.to as string };
}

function parseEnvelope(payload: unknown): { data: unknown[]; hasMore: boolean; window: DiscoveryWindow } {
  if (!record(payload) || !Array.isArray(payload.data) || payload.data.length > RESULT_LIMIT
    || typeof payload.hasMore !== "boolean") invalid();
  return { data: payload.data, hasMore: payload.hasMore, window: parseWindow(payload.window) };
}

function uniqueStrings(value: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > METADATA_LIMIT
    || !value.every((item) => typeof item === "string" && item.length <= IDENTITY_LIMIT
      && (allowEmpty || Boolean(item.trim()))) || new Set(value).size !== value.length) invalid();
  return [...value];
}

export function parseServiceDiscoveryResult(payload: unknown): ServiceDiscoveryResult {
  const result = parseEnvelope(payload);
  if (!result.data.every(identity) || new Set(result.data).size !== result.data.length) invalid();
  return { data: [...result.data] as string[], hasMore: result.hasMore, window: result.window };
}

export function parseMetricDiscoveryResult(payload: unknown, service: string): MetricDiscoveryResult {
  const result = parseEnvelope(payload);
  if (!record(payload) || payload.service !== service) invalid();
  const from = timestamp(result.window.from);
  const to = timestamp(result.window.to);
  const data = result.data.map((value): MetricDiscoveryDescriptor => {
    if (!record(value) || !identity(value.name) || typeof value.metadataTruncated !== "boolean") invalid();
    const lastSeen = timestamp(value.lastSeen);
    if (lastSeen < from || lastSeen > to) invalid();
    return {
      name: value.name, types: uniqueStrings(value.types), units: uniqueStrings(value.units, true),
      lastSeen: value.lastSeen as string, metadataTruncated: value.metadataTruncated,
    };
  });
  if (new Set(data.map((metric) => metric.name)).size !== data.length) invalid();
  return { service, data, hasMore: result.hasMore, window: result.window };
}

export class HttpMetricDiscoveryDataSource implements MetricDiscoveryDataSource {
  private readonly endpoint: string;

  constructor(apiBaseUrl: string, private readonly fetchFn: typeof fetch = (...args) => fetch(...args)) {
    this.endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/v1/metrics/discovery`;
  }

  services(applicationId: string, signal?: AbortSignal): Promise<ServiceDiscoveryResult> {
    if (!identity(applicationId)) throw new RuleRequestError("validation");
    const query = new URLSearchParams({ applicationId, limit: String(RESULT_LIMIT) });
    return requestRuleJson(this.fetchFn, `${this.endpoint}/services?${query}`, {
      method: "GET", headers: { Accept: "application/json" }, signal,
    }, parseServiceDiscoveryResult);
  }

  metrics(applicationId: string, service: string, signal?: AbortSignal): Promise<MetricDiscoveryResult> {
    if (!identity(applicationId) || !identity(service)) throw new RuleRequestError("validation");
    const query = new URLSearchParams({ applicationId, service, limit: String(RESULT_LIMIT) });
    return requestRuleJson(this.fetchFn, `${this.endpoint}/metrics?${query}`, {
      method: "GET", headers: { Accept: "application/json" }, signal,
    }, (payload) => parseMetricDiscoveryResult(payload, service));
  }
}
