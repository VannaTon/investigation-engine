import { clickhouse } from "../config/clickhouse.js";
import type { Span } from "../types/span.js";
import { toClickHouseDateTime64 } from "./clickhouse-datetime.js";

type SpanRecord = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  service: string;
  operation: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  status: "ok" | "error";
  metadata: string;
};

export class SpanRepository {
  private mapToSpan(record: SpanRecord): Span {
    const span: Span = {
      traceId: record.trace_id,
      spanId: record.span_id,
      service: record.service,
      operation: record.operation,
      startTime: `${record.start_time}Z`,
      endTime: `${record.end_time}Z`,
      durationMs: record.duration_ms,
      status: record.status,
      metadata: JSON.parse(record.metadata),
    };
    if (record.parent_span_id) {
      span.parentSpanId = record.parent_span_id;
    }

    return span;
  }
  async save(span: Span): Promise<void> {
    await clickhouse.insert({
      table: "spans",
      values: [
        {
          trace_id: span.traceId,
          span_id: span.spanId,
          parent_span_id: span.parentSpanId ?? null,
          service: span.service,
          operation: span.operation,
          start_time: span.startTime,
          end_time: span.endTime,
          duration_ms: span.durationMs,
          status: span.status,
          metadata: JSON.stringify(span.metadata ?? {}),
        },
      ],
      format: "JSONEachRow",
    });
  }

  async findByTraceId(traceId: string): Promise<Span[]> {
    const result = await clickhouse.query({
      query: `
      SELECT *
      FROM spans
      WHERE trace_id = {traceId:String}
      ORDER BY start_time ASC
    `,
      query_params: {
        traceId,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<SpanRecord>();

    const span = rows.map((row) => this.mapToSpan(row));

    return span;
  }

  async findByTraceIdForInvestigation(
    traceId: string,
    from: string,
    to: string,
  ): Promise<Span[]> {
    const result = await clickhouse.query({
      query: `
      SELECT *
      FROM spans
      WHERE trace_id = {traceId:String}
        AND start_time < {to:DateTime64(3)}
        AND end_time > {from:DateTime64(3)}
      ORDER BY start_time ASC
    `,
      query_params: {
        traceId,
        from: toClickHouseDateTime64(from),
        to: toClickHouseDateTime64(to),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<SpanRecord>();

    return rows.map((row) => this.mapToSpan(row));
  }

  async findTraceIdsForInvestigation(
    service: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    const result = await clickhouse.query({
      query: `
      SELECT DISTINCT trace_id
      FROM spans
      WHERE service = {service:String}
        AND start_time < {to:DateTime64(3)}
        AND end_time > {from:DateTime64(3)}
      ORDER BY trace_id
    `,
      query_params: {
        service,
        from: toClickHouseDateTime64(from),
        to: toClickHouseDateTime64(to),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ trace_id: string }>();

    return rows.map((row) => row.trace_id);
  }

  async findCandidateTraceIds(
    service: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    const result = await clickhouse.query({
      query: `
      SELECT DISTINCT trace_id
      FROM spans
      WHERE service = {service:String}
        AND start_time < {to:DateTime64(3)}
        AND end_time > {from:DateTime64(3)}
    `,
      query_params: {
        service,
        from: toClickHouseDateTime64(from),
        to: toClickHouseDateTime64(to),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ trace_id: string }>();

    return rows.map((row) => row.trace_id);
  }
}
