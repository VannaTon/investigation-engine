import { clickhouse } from "../config/clickhouse.js";

export const METRIC_REQUIRED_DEDUPLICATION_WINDOW = 10_000;

type MetricStorageQueryClient = Pick<typeof clickhouse, "query">;

interface MetricTableRow {
  engine: string;
  engine_full: string;
}

export interface MetricStorageReadiness {
  engine: string;
  configuredWindow: number;
  requiredWindow: number;
}

export function parseNonReplicatedDeduplicationWindow(
  engineFull: string,
): number | undefined {
  const match =
    /\bnon_replicated_deduplication_window\s*=\s*(\d+)\b/.exec(engineFull);

  if (match?.[1] === undefined) {
    return undefined;
  }

  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

export class MetricStorageReadinessService {
  constructor(
    private readonly queryClient: MetricStorageQueryClient = clickhouse,
    private readonly requiredWindow = METRIC_REQUIRED_DEDUPLICATION_WINDOW,
  ) {}

  async inspect(): Promise<MetricStorageReadiness> {
    const result = await this.queryClient.query({
      query:
        "SELECT engine, engine_full FROM system.tables " +
        "WHERE database = currentDatabase() AND name = 'metrics'",
      format: "JSONEachRow",
    });
    const rows = await result.json<MetricTableRow>();
    const table = rows[0];

    if (table === undefined) {
      throw new Error(
        "Metric recovery requires the observability.metrics table.",
      );
    }

    if (table.engine !== "MergeTree") {
      throw new Error(
        "Metric recovery requires the non-replicated MergeTree metrics table; " +
          "found " +
          table.engine +
          ".",
      );
    }

    const configuredWindow = parseNonReplicatedDeduplicationWindow(
      table.engine_full,
    );

    if (configuredWindow === undefined) {
      throw new Error(
        "Metric recovery could not verify non_replicated_deduplication_window.",
      );
    }

    return {
      engine: table.engine,
      configuredWindow,
      requiredWindow: this.requiredWindow,
    };
  }

  async assertReady(): Promise<MetricStorageReadiness> {
    const readiness = await this.inspect();

    if (readiness.configuredWindow < readiness.requiredWindow) {
      throw new Error(
        "Metric recovery requires non_replicated_deduplication_window >= " +
          String(readiness.requiredWindow) +
          "; found " +
          String(readiness.configuredWindow) +
          ".",
      );
    }

    return readiness;
  }
}
