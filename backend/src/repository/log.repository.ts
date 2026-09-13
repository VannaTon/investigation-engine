import { clickhouse } from "../config/clickhouse.js";
import type { LogEvent } from "../types/log-event.js";
import type { LogQuery } from "../types/log.query.js";
import type { LogQueryResult } from "../types/log-query-result.js";
import { postgres } from "../config/postgres.js";

type LogInsertClient = Pick<typeof clickhouse, "insert">;

export interface LogSaveOptions {
  deduplicationToken?: string;
}

type LogRecord = {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  stack_trace: string | null;
  trace_id: string | null;
  span_id: string | null;
  environment: string | null;
  metadata: string;
  fingerprint: string;
};

export class LogRepository {
  constructor(private readonly insertClient: LogInsertClient = clickhouse) {}

  private mapToLogEvent(row: LogRecord): LogEvent {
    const event: LogEvent = {
      timestamp: `${row.timestamp}Z`,
      service: row.service,
      level: row.level as LogEvent["level"],
      message: row.message,
      metadata: JSON.parse(row.metadata),
    };

    if (row.stack_trace !== null) {
      event.stackTrace = row.stack_trace;
    }

    if (row.trace_id !== null) {
      event.traceId = row.trace_id;
    }

    if (row.span_id !== null) {
      event.spanId = row.span_id;
    }

    if (row.environment !== null) {
      event.environment = row.environment;
    }

    return event;
  }

  private buildWhereClause(query: LogQuery): string {
    const conditions: string[] = [];

    if (query.service) {
      conditions.push("service = {service:String}");
    }

    if (query.level) {
      conditions.push("level = {level:String}");
    }

    if (query.from) {
      conditions.push("timestamp >= parseDateTime64BestEffort({from:String})");
    }

    if (query.to) {
      conditions.push("timestamp <= parseDateTime64BestEffort({to:String})");
    }

    if (query.cursor) {
      conditions.push("timestamp < parseDateTime64BestEffort({cursor:String})");
    }

    if (query.search) {
      conditions.push("positionCaseInsensitive(message, {search:String}) > 0");
    }

    if (query.traceId) {
      conditions.push("trace_id = {traceId:String}");
    }

    if (query.fingerprint) {
      conditions.push("fingerprint = {fingerprint:String}");
    }

    return conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  }

  private buildQuery(whereClause: string): string {
    return `
    SELECT *
    FROM logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT {limit:UInt32}
  `;
  }

  async save(
    event: LogEvent,
    options: LogSaveOptions = {},
  ): Promise<void> {
    await this.insertClient.insert({
      table: "logs",
      values: [
        {
          timestamp: event.timestamp,
          service: event.service,
          level: event.level,
          message: event.message,
          stack_trace: event.stackTrace ?? null,
          trace_id: event.traceId ?? null,
          span_id: event.spanId ?? null,
          environment: event.environment ?? null,
          metadata: JSON.stringify(event.metadata ?? {}),
          fingerprint: event.fingerprint ?? "",
        },
      ],
      format: "JSONEachRow",
      ...(options.deduplicationToken === undefined
        ? {}
        : {
            clickhouse_settings: {
              insert_deduplication_token: options.deduplicationToken,
            },
          }),
    });
  }

  async find(query: LogQuery): Promise<LogQueryResult> {
    const whereClause = this.buildWhereClause(query);
    const limit = query.limit ?? 100;
    const sql = this.buildQuery(whereClause);
    const result = await clickhouse.query({
      query: sql,
      query_params: {
        service: query.service,
        level: query.level,
        from: query.from,
        to: query.to,
        cursor: query.cursor,
        limit: limit + 1,
        traceId: query.traceId,
        search: query.search,
        fingerprint: query.fingerprint,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<LogRecord>();

    const logs = rows.map((row) => this.mapToLogEvent(row));
    const hasMore = logs.length > limit;
    if (hasMore) {
      logs.pop();
    }
    const lastLog = logs.at(-1);

    const data: LogQueryResult = {
      data: logs,
      hasMore,
    };

    if (lastLog) {
      data.nextCursor = lastLog.timestamp;
    }

    return data;
  }

  async findForInvestigation(
    service: string,
    from: string,
    to: string,
  ): Promise<LogEvent[]> {
    const result = await clickhouse.query({
      query: `
      SELECT *
      FROM logs
      WHERE service = {service:String}
        AND timestamp >= parseDateTime64BestEffort({from:String})
        AND timestamp <= parseDateTime64BestEffort({to:String})
      ORDER BY timestamp ASC
      LIMIT 500;
    `,
      query_params: {
        service,
        from,
        to,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<LogRecord>();

    return rows.map((row) => this.mapToLogEvent(row));
  }

  async findRelevantForInvestigation(
    alertService: string,
    incidentTraceIds: string[],
    from: string,
    to: string,
  ): Promise<LogEvent[]> {
    const result = await clickhouse.query({
      query: `
      SELECT *
      FROM logs
      WHERE (
          service = {alertService:String}
          OR trace_id IN {incidentTraceIds:Array(String)}
        )
        AND timestamp >= parseDateTime64BestEffort({from:String})
        AND timestamp <= parseDateTime64BestEffort({to:String})
      ORDER BY timestamp ASC
      LIMIT 500;
    `,
      query_params: {
        alertService,
        incidentTraceIds,
        from,
        to,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<LogRecord>();

    return rows.map((row) => this.mapToLogEvent(row));
  }

  async findByFingerprint(fingerprint: string): Promise<LogQueryResult> {
    const result = await postgres.query(
      `SELECT *
FROM logs
WHERE fingerprint = {fingerprint:String}
ORDER BY timestamp DESC
LIMIT 100; `,
      [fingerprint],
    );

    return result.rows[0];
  }
}
