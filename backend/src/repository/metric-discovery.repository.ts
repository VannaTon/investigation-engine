import { clickhouse } from "../config/clickhouse.js";
import type { DiscoveredMetric, MetricDiscoveryWindow } from "../types/metric-discovery.js";

type MetricDiscoveryQueryClient = Pick<typeof clickhouse, "query">;
type DiscoveryRows<T> = { data: T[]; hasMore: boolean };
interface MetricDiscoveryRow {
  name: string;
  types: string[];
  units: string[];
  lastSeen: string;
  metadataTruncated: boolean | number;
}

const recentWhere = `timestamp >= parseDateTime64BestEffort({from:String}, 3, 'UTC')
  AND timestamp <= parseDateTime64BestEffort({to:String}, 3, 'UTC')`;

// Throw rather than quietly returning partial discovery if the fixed scan budget is exceeded.
const discoverySettings = {
  max_execution_time: 5,
  timeout_overflow_mode: "throw",
  max_memory_usage: "67108864",
  max_rows_to_read: "1000000",
  read_overflow_mode: "throw",
} as const;

function page<T>(rows: T[], limit: number): DiscoveryRows<T> {
  return { data: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** A bounded view of recently observed scalar metrics, not a complete metric catalog. */
export class MetricDiscoveryRepository {
  constructor(private readonly queryClient: MetricDiscoveryQueryClient = clickhouse) {}

  async findServices(
    applicationId: string,
    window: MetricDiscoveryWindow,
    limit: number,
  ): Promise<DiscoveryRows<string>> {
    const result = await this.queryClient.query({
      query: `SELECT service
FROM metrics
WHERE application_id = {applicationId:UUID} AND ${recentWhere}
GROUP BY service
ORDER BY service ASC
LIMIT {limit:UInt32}`,
      query_params: { applicationId, ...window, limit: limit + 1 },
      format: "JSONEachRow",
      clickhouse_settings: discoverySettings,
    });
    const rows = await result.json<{ service: string }>();
    return page(rows.map((row) => row.service), limit);
  }

  async findMetrics(
    applicationId: string,
    service: string,
    window: MetricDiscoveryWindow,
    limit: number,
  ): Promise<DiscoveryRows<DiscoveredMetric>> {
    const result = await this.queryClient.query({
      query: `SELECT name,
  arraySlice(arraySort(observedTypes), 1, 20) AS types,
  arraySlice(arraySort(observedUnits), 1, 20) AS units,
  lastSeen,
  (length(observedTypes) > 20 OR length(observedUnits) > 20) AS metadataTruncated
FROM (
  SELECT name,
    groupUniqArray(21)(type) AS observedTypes,
    groupUniqArray(21)(ifNull(unit, '')) AS observedUnits,
    toString(max(timestamp), 'UTC') AS lastSeen
  FROM metrics
  WHERE application_id = {applicationId:UUID}
    AND service = {service:String} AND ${recentWhere}
  GROUP BY name
)
ORDER BY name ASC
LIMIT {limit:UInt32}`,
      query_params: { applicationId, service, ...window, limit: limit + 1 },
      format: "JSONEachRow",
      clickhouse_settings: discoverySettings,
    });
    const rows = await result.json<MetricDiscoveryRow>();
    return page(rows.map((row) => ({
      name: row.name,
      types: row.types,
      units: row.units,
      lastSeen: new Date(row.lastSeen.replace(" ", "T") + "Z").toISOString(),
      metadataTruncated: Boolean(row.metadataTruncated),
    })), limit);
  }
}
