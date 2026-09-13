import { clickhouse } from "../config/clickhouse.js";
import {
  METRIC_REQUIRED_DEDUPLICATION_WINDOW,
  parseNonReplicatedDeduplicationWindow,
  type MetricStorageReadiness,
} from "./metric-storage-readiness.service.js";

export const HISTOGRAM_METRIC_REQUIRED_DEDUPLICATION_WINDOW =
  METRIC_REQUIRED_DEDUPLICATION_WINDOW;

type HistogramMetricStorageQueryClient = Pick<typeof clickhouse, "query">;

interface HistogramMetricTableRow {
  engine: string;
  engine_full: string;
}

export class HistogramMetricStorageReadinessService {
  constructor(
    private readonly queryClient: HistogramMetricStorageQueryClient =
      clickhouse,
    private readonly requiredWindow =
      HISTOGRAM_METRIC_REQUIRED_DEDUPLICATION_WINDOW,
  ) {}

  async inspect(): Promise<MetricStorageReadiness> {
    const result = await this.queryClient.query({
      query:
        "SELECT engine, engine_full FROM system.tables " +
        "WHERE database = currentDatabase() " +
        "AND name = 'metric_histograms'",
      format: "JSONEachRow",
    });
    const rows = await result.json<HistogramMetricTableRow>();
    const table = rows[0];

    if (table === undefined) {
      throw new Error(
        "Histogram metric recovery requires the " +
          "observability.metric_histograms table.",
      );
    }

    if (table.engine !== "MergeTree") {
      throw new Error(
        "Histogram metric recovery requires the non-replicated " +
          "MergeTree metric_histograms table; found " +
          table.engine +
          ".",
      );
    }

    const configuredWindow = parseNonReplicatedDeduplicationWindow(
      table.engine_full,
    );

    if (configuredWindow === undefined) {
      throw new Error(
        "Histogram metric recovery could not verify " +
          "non_replicated_deduplication_window.",
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
        "Histogram metric recovery requires " +
          "non_replicated_deduplication_window >= " +
          String(readiness.requiredWindow) +
          "; found " +
          String(readiness.configuredWindow) +
          ".",
      );
    }

    return readiness;
  }
}
