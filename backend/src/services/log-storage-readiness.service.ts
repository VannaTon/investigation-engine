import { clickhouse } from "../config/clickhouse.js";
import { postgres } from "../config/postgres.js";

export const LOG_REQUIRED_DEDUPLICATION_WINDOW = 10_000;

type LogStorageQueryClient = Pick<typeof clickhouse, "query">;
type LogLedgerQueryClient = Pick<typeof postgres, "query">;

interface LogTableRow {
  engine: string;
  engine_full: string;
}

export interface LogStorageReadiness {
  engine: string;
  configuredWindow: number;
  requiredWindow: number;
  occurrenceLedgerTable: "error_group_occurrences";
}

export function parseLogNonReplicatedDeduplicationWindow(
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

export class LogStorageReadinessService {
  constructor(
    private readonly queryClient: LogStorageQueryClient = clickhouse,
    private readonly requiredWindow = LOG_REQUIRED_DEDUPLICATION_WINDOW,
    private readonly ledgerQueryClient: LogLedgerQueryClient = postgres,
  ) {}

  async inspect(): Promise<LogStorageReadiness> {
    const result = await this.queryClient.query({
      query:
        "SELECT engine, engine_full FROM system.tables " +
        "WHERE database = currentDatabase() AND name = 'logs'",
      format: "JSONEachRow",
    });
    const rows = await result.json<LogTableRow>();
    const table = rows[0];

    if (table === undefined) {
      throw new Error("Log recovery requires the observability.logs table.");
    }

    if (table.engine !== "MergeTree") {
      throw new Error(
        "Log recovery requires the non-replicated MergeTree logs table; " +
          "found " +
          table.engine +
          ".",
      );
    }

    const configuredWindow = parseLogNonReplicatedDeduplicationWindow(
      table.engine_full,
    );

    if (configuredWindow === undefined) {
      throw new Error(
        "Log recovery could not verify non_replicated_deduplication_window.",
      );
    }

    const ledgerResult = await this.ledgerQueryClient.query<{
      exists: boolean;
    }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'error_group_occurrences'
      ) AS exists;
    `);

    if (ledgerResult.rows[0]?.exists !== true) {
      throw new Error(
        "Log recovery requires the public.error_group_occurrences table.",
      );
    }

    return {
      engine: table.engine,
      configuredWindow,
      requiredWindow: this.requiredWindow,
      occurrenceLedgerTable: "error_group_occurrences",
    };
  }

  async assertReady(): Promise<LogStorageReadiness> {
    const readiness = await this.inspect();

    if (readiness.configuredWindow < readiness.requiredWindow) {
      throw new Error(
        "Log recovery requires non_replicated_deduplication_window >= " +
          String(readiness.requiredWindow) +
          "; found " +
          String(readiness.configuredWindow) +
          ".",
      );
    }

    return readiness;
  }
}
