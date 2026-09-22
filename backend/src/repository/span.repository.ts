import { clickhouse } from "../config/clickhouse.js";
import type { Span } from "../types/span.js";
import { toClickHouseDateTime64 } from "./clickhouse-datetime.js";
import type { ApplicationTelemetry } from "../types/application.js";

type SpanRecord = {
  application_id: string;
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
  private mapToSpan(record: SpanRecord): ApplicationTelemetry<Span> {
    const span: ApplicationTelemetry<Span> = {
      applicationId: record.application_id,
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
  async save(span: ApplicationTelemetry<Span>): Promise<void> {
    await clickhouse.insert({
      table: "spans",
      values: [
        {
          application_id: span.applicationId,
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

  async findByTraceId(
    applicationId: string,
    traceId: string,
  ): Promise<ApplicationTelemetry<Span>[]> {
    const result = await clickhouse.query({
      query: `
      SELECT *
      FROM spans
      WHERE application_id = {applicationId:UUID}
        AND trace_id = {traceId:String}
      ORDER BY start_time ASC
    `,
      query_params: {
        applicationId,
        traceId,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<SpanRecord>();

    const span = rows.map((row) => this.mapToSpan(row));

    return span;
  }

  async findByTraceIdForInvestigation(
    applicationId: string,
    traceId: string,
    from: string,
    to: string,
  ): Promise<ApplicationTelemetry<Span>[]> {
    const result = await clickhouse.query({
      query: `
      SELECT *
      FROM spans
      WHERE application_id = {applicationId:UUID}
        AND trace_id = {traceId:String}
        AND start_time < {to:DateTime64(3)}
        AND end_time > {from:DateTime64(3)}
      ORDER BY start_time ASC
    `,
      query_params: {
        applicationId,
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
    applicationId: string,
    service: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    const result = await clickhouse.query({
      query: `
      SELECT DISTINCT trace_id
      FROM spans
      WHERE application_id = {applicationId:UUID}
        AND service = {service:String}
        AND start_time < {to:DateTime64(3)}
        AND end_time > {from:DateTime64(3)}
      ORDER BY trace_id
    `,
      query_params: {
        applicationId,
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
    applicationId: string,
    service: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    const result = await clickhouse.query({
      query: `
      SELECT DISTINCT trace_id
      FROM spans
      WHERE application_id = {applicationId:UUID}
        AND service = {service:String}
        AND start_time < {to:DateTime64(3)}
        AND end_time > {from:DateTime64(3)}
    `,
      query_params: {
        applicationId,
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
