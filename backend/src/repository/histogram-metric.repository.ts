import { Buffer } from "node:buffer";
import { clickhouse } from "../config/clickhouse.js";
import type { HistogramMetricEvent } from "../types/histogram-metric-event.js";
import type { HistogramMetricQuery } from "../types/histogram-metric-query.js";
import type { HistogramMetricQueryResult } from "../types/histogram-metric-query-result.js";
import type { ApplicationTelemetry } from "../types/application.js";

const DEFAULT_QUERY_LIMIT = 50;
export const MAX_HISTOGRAM_METRIC_QUERY_LIMIT = 100;
const REDIS_MESSAGE_ID = /^\d+-\d+$/;

type HistogramMetricClient = Pick<typeof clickhouse, "insert" | "query">;

export interface HistogramMetricSaveOptions {
  streamMessageId: string;
  deduplicationToken?: string;
}

export interface HistogramMetricRecord {
  application_id: string;
  timestamp: string;
  service: string;
  name: string;
  temporality: HistogramMetricEvent["temporality"];
  count: string;
  sum: number | null;
  min: number | null;
  max: number | null;
  bucket_counts: string[];
  explicit_bounds: number[];
  unit: string | null;
  metadata: string;
  stream_message_id: string;
}

interface HistogramMetricCursor {
  timestamp: string;
  streamMessageId: string;
}

export class HistogramMetricQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistogramMetricQueryError";
  }
}

function validTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function storageTimestamp(value: string): string {
  const isoCandidate =
    value.includes("T") || value.endsWith("Z")
      ? value
      : value.replace(" ", "T") + "Z";
  const timestamp = new Date(isoCandidate);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("ClickHouse returned an invalid histogram timestamp.");
  }

  return timestamp.toISOString();
}

export function encodeHistogramMetricCursor(
  cursor: HistogramMetricCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeHistogramMetricCursor(
  value: string,
): HistogramMetricCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("cursor payload must be an object");
    }

    const record = parsed as Record<string, unknown>;
    if (
      typeof record.timestamp !== "string" ||
      !validTimestamp(record.timestamp) ||
      typeof record.streamMessageId !== "string" ||
      !REDIS_MESSAGE_ID.test(record.streamMessageId)
    ) {
      throw new Error("cursor fields are invalid");
    }

    return {
      timestamp: record.timestamp,
      streamMessageId: record.streamMessageId,
    };
  } catch {
    throw new HistogramMetricQueryError(
      "Histogram metric cursor is invalid.",
    );
  }
}

function queryLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_QUERY_LIMIT;

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_HISTOGRAM_METRIC_QUERY_LIMIT
  ) {
    throw new HistogramMetricQueryError(
      "Histogram metric limit must be an integer from 1 through 100.",
    );
  }

  return limit;
}

function optionalTimestamp(
  value: string | undefined,
  field: "from" | "to",
): void {
  if (value !== undefined && !validTimestamp(value)) {
    throw new HistogramMetricQueryError(
      "Histogram metric " + field + " must be a valid timestamp.",
    );
  }
}

function mapRecord(row: HistogramMetricRecord): ApplicationTelemetry<HistogramMetricEvent> {
  const event: ApplicationTelemetry<HistogramMetricEvent> = {
    applicationId: row.application_id,
    timestamp: storageTimestamp(row.timestamp),
    service: row.service,
    name: row.name,
    type: "histogram",
    temporality: row.temporality,
    count: row.count,
    bucketCounts: [...row.bucket_counts],
    explicitBounds: [...row.explicit_bounds],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };

  if (row.unit !== null) event.unit = row.unit;
  if (row.sum !== null) event.sum = row.sum;
  if (row.min !== null) event.min = row.min;
  if (row.max !== null) event.max = row.max;

  return event;
}

export class HistogramMetricRepository {
  constructor(
    private readonly client: HistogramMetricClient = clickhouse,
  ) {}

  async save(
    event: ApplicationTelemetry<HistogramMetricEvent>,
    options: HistogramMetricSaveOptions,
  ): Promise<void> {
    await this.client.insert({
      table: "metric_histograms",
      values: [
        {
          application_id: event.applicationId,
          timestamp: event.timestamp,
          service: event.service,
          name: event.name,
          temporality: event.temporality,
          count: event.count,
          sum: event.sum ?? null,
          min: event.min ?? null,
          max: event.max ?? null,
          bucket_counts: event.bucketCounts,
          explicit_bounds: event.explicitBounds,
          unit: event.unit ?? null,
          metadata: JSON.stringify(event.metadata ?? {}),
          stream_message_id: options.streamMessageId,
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

  async find(
    query: HistogramMetricQuery,
  ): Promise<HistogramMetricQueryResult> {
    const limit = queryLimit(query.limit);
    optionalTimestamp(query.from, "from");
    optionalTimestamp(query.to, "to");

    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeHistogramMetricCursor(query.cursor);
    const conditions: string[] = [
      "application_id = {applicationId:UUID}",
    ];

    if (query.service !== undefined) {
      conditions.push("service = {service:String}");
    }
    if (query.name !== undefined) {
      conditions.push("name = {name:String}");
    }
    if (query.from !== undefined) {
      conditions.push(
        "timestamp >= parseDateTime64BestEffort({from:String})",
      );
    }
    if (query.to !== undefined) {
      conditions.push(
        "timestamp <= parseDateTime64BestEffort({to:String})",
      );
    }
    if (cursor !== undefined) {
      conditions.push(
        "(timestamp, stream_message_id) < " +
          "(parseDateTime64BestEffort({cursorTimestamp:String}), " +
          "{cursorMessageId:String})",
      );
    }

    const where =
      conditions.length === 0 ? "" : "WHERE " + conditions.join(" AND ");
    const result = await this.client.query({
      query:
        "SELECT * FROM metric_histograms " +
        where +
        " ORDER BY timestamp DESC, stream_message_id DESC " +
        "LIMIT {limit:UInt32}",
      query_params: {
        applicationId: query.applicationId,
        service: query.service,
        name: query.name,
        from: query.from,
        to: query.to,
        cursorTimestamp: cursor?.timestamp,
        cursorMessageId: cursor?.streamMessageId,
        limit: limit + 1,
      },
      format: "JSONEachRow",
      clickhouse_settings: {
        output_format_json_quote_64bit_integers: 1,
      },
    });
    const rows = await result.json<HistogramMetricRecord>();
    const pageRows = rows.slice(0, limit);
    const response: HistogramMetricQueryResult = {
      data: pageRows.map(mapRecord),
      hasMore: rows.length > limit,
    };
    const last = pageRows.at(-1);

    if (last !== undefined) {
      response.nextCursor = encodeHistogramMetricCursor({
        timestamp: storageTimestamp(last.timestamp),
        streamMessageId: last.stream_message_id,
      });
    }

    return response;
  }
}
