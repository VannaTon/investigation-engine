import { clickhouse } from "../config/clickhouse.js";
import type { MetricEvent } from "../types/metric-event.js";
import type { MetricQueryResult } from "../types/metric-query-result.js";
import type { MetricQuery } from "./../types/metrics-query.js";
import type { MetricAggregateQuery } from "../types/metric-aggregate-query.js";
import type { MetricAggregateResult } from "../types/metric-aggregate-result.js";
import type { ApplicationTelemetry } from "../types/application.js";

export type MetricRecord = {
  application_id: string;
  timestamp: string;
  service: string;
  name: string;
  type: string;
  value: number;
  unit: string | null;
  metadata: string;
};

type MetricInsertClient = Pick<typeof clickhouse, "insert">;

export interface MetricSaveOptions {
  deduplicationToken?: string;
}

export class MetricRepository {
  constructor(private readonly insertClient: MetricInsertClient = clickhouse) {}

  private mapToMetricEvent(row: MetricRecord): ApplicationTelemetry<MetricEvent> {
    const event: ApplicationTelemetry<MetricEvent> = {
      applicationId: row.application_id,
      timestamp: `${row.timestamp}Z`,
      service: row.service,
      name: row.name,
      type: row.type as MetricEvent["type"],
      value: row.value,
      metadata: JSON.parse(row.metadata),
    };
    if (row.unit !== null) {
      event.unit = row.unit;
    }

    return event;
  }

  private buildWhereClause(query: MetricQuery): string {
    const conditions: string[] = [
      "application_id = {applicationId:UUID}",
    ];
    if (query.service) {
      conditions.push("service = {service:String}");
    }

    if (query.name) {
      conditions.push("name = {name:String}");
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

    return conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  }

  private buildQuery(whereClause: string): string {
    return `
    SELECT *
    FROM metrics
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT {limit:UInt32}
  `;
  }
  async save(
    event: ApplicationTelemetry<MetricEvent>,
    options: MetricSaveOptions = {},
  ): Promise<void> {
    await this.insertClient.insert({
      table: "metrics",
      values: [
        {
          application_id: event.applicationId,
          timestamp: event.timestamp,
          service: event.service,
          name: event.name,
          type: event.type,
          value: event.value,
          unit: event.unit ?? null,
          metadata: JSON.stringify(event.metadata ?? {}),
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

  async find(query: MetricQuery): Promise<MetricQueryResult> {
    const whereClause = this.buildWhereClause(query);
    const limit = query.limit ?? 100;
    const sql = this.buildQuery(whereClause);

    const result = await clickhouse.query({
      query: sql,
      query_params: {
        applicationId: query.applicationId,
        service: query.service,
        name: query.name,
        from: query.from,
        to: query.to,
        cursor: query.cursor,
        limit: limit + 1,
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<MetricRecord>();
    const metrics = rows.map((row) => this.mapToMetricEvent(row));
    const hasMore = metrics.length > limit;
    if (hasMore) {
      metrics.pop();
    }

    const qresult: MetricQueryResult = {
      data: metrics,
      hasMore,
    };

    const lastMetric = metrics.at(-1);

    if (lastMetric) {
      qresult.nextCursor = lastMetric.timestamp;
    }

    return qresult;
  }

  async aggregate(query: MetricAggregateQuery): Promise<MetricAggregateResult> {
    const conditions: string[] = [
      "application_id = {applicationId:UUID}",
      "name = {name:String}",
    ];

    if (query.service) {
      conditions.push("service = {service:String}");
    }

    if (query.from) {
      conditions.push("timestamp >= parseDateTime64BestEffort({from:String})");
    }

    if (query.to) {
      conditions.push("timestamp <= parseDateTime64BestEffort({to:String})");
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const result = await clickhouse.query({
      query: `
      SELECT
        name,
        service,
        count() AS count,
        avg(value) AS avg,
        min(value) AS min,
        max(value) AS max,
        sum(value) AS sum
      FROM metrics
      ${whereClause}
      GROUP BY name, service
    `,
      query_params: {
        applicationId: query.applicationId,
        name: query.name,
        service: query.service,
        from: query.from,
        to: query.to,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      name: string;
      service: string;
      count: number;
      avg: number;
      min: number;
      max: number;
      sum: number;
    }>();

    const row = rows[0];

    if (!row) {
      throw new Error("No metrics found.");
    }

    return {
      name: row.name,
      service: row.service,
      count: Number(row.count),
      avg: Number(row.avg),
      min: Number(row.min),
      max: Number(row.max),
      sum: Number(row.sum),
    };
  }
  async findForInvestigation(
    applicationId: string,
    service: string,
    from: string,
    to: string,
  ): Promise<MetricEvent[]> {
    const result = await clickhouse.query({
      query: `SELECT *
FROM metrics
WHERE application_id = {applicationId:UUID}
  AND service = {service:String}
  AND timestamp >= parseDateTime64BestEffort({from:String})
  AND timestamp <= parseDateTime64BestEffort({to:String})
ORDER BY timestamp ASC
LIMIT 500;`,
      query_params: {
        applicationId,
        service,
        from,
        to,
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<MetricRecord>();
    const metric = rows.map((row) => this.mapToMetricEvent(row));
    return metric;
  }

  async findForAlertEvaluation(
    applicationId: string,
    name: string,
    service: string,
    from: string,
    to: string,
  ): Promise<MetricEvent[]> {
    const result = await clickhouse.query({
      query: `
      SELECT *
      FROM metrics
      WHERE application_id = {applicationId:UUID}
        AND name = {name:String}
        AND service = {service:String}
        AND timestamp >= parseDateTime64BestEffort({from:String})
        AND timestamp <= parseDateTime64BestEffort({to:String})
      ORDER BY timestamp ASC
      LIMIT 500;
    `,
      query_params: {
        applicationId,
        name,
        service,
        from,
        to,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<MetricRecord>();

    return rows.map((row) => this.mapToMetricEvent(row));
  }

  async findForAlertRecovery(
    applicationId: string,
    name: string,
    service: string,
    from: string,
    to: string,
  ): Promise<MetricEvent[]> {
    const result = await clickhouse.query({
      query: `
      SELECT *
      FROM metrics
      WHERE application_id = {applicationId:UUID}
        AND name = {name:String}
        AND service = {service:String}
        AND timestamp >= parseDateTime64BestEffort({from:String})
        AND timestamp <= parseDateTime64BestEffort({to:String})
      ORDER BY timestamp ASC
      LIMIT 500;
    `,
      query_params: {
        applicationId,
        name,
        service,
        from,
        to,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<MetricRecord>();

    return rows.map((row) => this.mapToMetricEvent(row));
  }
}
