import type { MetricDiscoveryRepository } from "../repository/metric-discovery.repository.js";
import type {
  DiscoveredMetricsResult,
  MetricDiscoveryPage,
  MetricDiscoveryQuery,
  MetricDiscoveryWindow,
  ServiceMetricDiscoveryQuery,
} from "../types/metric-discovery.js";

export const METRIC_DISCOVERY_DEFAULT_LIMIT = 200;
export const METRIC_DISCOVERY_MAX_LIMIT = 500;
export const METRIC_DISCOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export class MetricDiscoveryInputError extends Error {}

function queryObject(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MetricDiscoveryInputError("Discovery query is invalid.");
  }
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some((key) => !allowedKeys.includes(key))) {
    throw new MetricDiscoveryInputError("Discovery query contains unsupported parameters.");
  }
  return query;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return METRIC_DISCOVERY_DEFAULT_LIMIT;
  // Validate the original query value, before numeric conversion or schema coercion.
  if (typeof value !== "string" || !/^[1-9]\d{0,2}$/.test(value)) {
    throw new MetricDiscoveryInputError("Discovery limit must be an integer from 1 to 500.");
  }
  const limit = Number(value);
  if (limit > METRIC_DISCOVERY_MAX_LIMIT) {
    throw new MetricDiscoveryInputError("Discovery limit must be an integer from 1 to 500.");
  }
  return limit;
}

function parseApplicationId(value: unknown): string {
  if (typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new MetricDiscoveryInputError("A valid application is required.");
  }
  return value;
}

export function parseServiceDiscoveryQuery(value: unknown): MetricDiscoveryQuery {
  const query = queryObject(value, ["applicationId", "limit"]);
  return { applicationId: parseApplicationId(query.applicationId), limit: parseLimit(query.limit) };
}

export function parseMetricDiscoveryQuery(value: unknown): ServiceMetricDiscoveryQuery {
  const query = queryObject(value, ["applicationId", "service", "limit"]);
  if (typeof query.service !== "string" || query.service.trim().length === 0 ||
      query.service.length > 512) {
    throw new MetricDiscoveryInputError("An exact service name of 1 to 512 characters is required.");
  }
  return { applicationId: parseApplicationId(query.applicationId),
    service: query.service, limit: parseLimit(query.limit) };
}

export class MetricDiscoveryService {
  constructor(
    private readonly repository: Pick<MetricDiscoveryRepository, "findServices" | "findMetrics">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private recentWindow(): MetricDiscoveryWindow {
    const to = this.now();
    return { from: new Date(to.getTime() - METRIC_DISCOVERY_WINDOW_MS).toISOString(),
      to: to.toISOString() };
  }

  async findServices(query: MetricDiscoveryQuery): Promise<MetricDiscoveryPage<string>> {
    const window = this.recentWindow();
    const result = await this.repository.findServices(query.applicationId, window, query.limit);
    return { ...result, window };
  }

  async findMetrics(query: ServiceMetricDiscoveryQuery): Promise<DiscoveredMetricsResult> {
    const window = this.recentWindow();
    const result = await this.repository.findMetrics(
      query.applicationId, query.service, window, query.limit);
    return { ...result, service: query.service, window };
  }
}
