import { postgres } from "../config/postgres.js";
import type { ErrorGroup } from "../types/error-group.js";
import type { LogEvent } from "../types/log-event.js";
import type { ErrorGroupStatus } from "../types/error-group.js";
import type { ApplicationTelemetry } from "../types/application.js";

export interface ErrorGroupOccurrenceIdentity {
  sourceStream: string;
  sourceGroup: string;
  messageId: string;
}

export type ErrorGroupOccurrenceResult = "recorded" | "duplicate";

type ErrorGroupDatabase = Pick<typeof postgres, "connect" | "query">;

export class ErrorGroupRepository {
  constructor(private readonly database: ErrorGroupDatabase = postgres) {}

  async upsert(event: ApplicationTelemetry<LogEvent>, normalizedMessage: string): Promise<void> {
    if (!event.fingerprint) {
      throw new Error("Fingerprint is required.");
    }

    await this.database.query(
      `
      INSERT INTO error_groups (
        application_id,
        fingerprint,
        normalized_message,
        normalizer_version,
        sample_message,
        occurrence_count,
        first_seen,
        last_seen,
        example_trace_id,
        status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        1,
        $6,
        $6,
        $7,
        'open'
      )
      ON CONFLICT (application_id, fingerprint)
      DO UPDATE SET
        occurrence_count = error_groups.occurrence_count + 1,
        last_seen = EXCLUDED.last_seen,
        example_trace_id = EXCLUDED.example_trace_id,
        updated_at = CURRENT_TIMESTAMP;
      `,
      [
        event.applicationId,
        event.fingerprint,
        normalizedMessage,
        1, // normalizer_version
        event.message,
        event.timestamp,
        event.traceId ?? null,
      ],
    );
  }

  async upsertOnce(
    event: ApplicationTelemetry<LogEvent>,
    normalizedMessage: string,
    identity: ErrorGroupOccurrenceIdentity,
  ): Promise<ErrorGroupOccurrenceResult> {
    if (!event.fingerprint) {
      throw new Error("Fingerprint is required.");
    }

    const client = await this.database.connect();

    try {
      await client.query("BEGIN");

      const occurrence = await client.query<{ fingerprint: string }>(
        `
        INSERT INTO error_group_occurrences (
          application_id,
          source_stream,
          source_group,
          message_id,
          fingerprint
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (source_stream, source_group, message_id)
        DO NOTHING
        RETURNING fingerprint;
        `,
        [
          event.applicationId,
          identity.sourceStream,
          identity.sourceGroup,
          identity.messageId,
          event.fingerprint,
        ],
      );

      if (occurrence.rows[0] === undefined) {
        const existing = await client.query<{ fingerprint: string }>(
          `
          SELECT fingerprint
          FROM error_group_occurrences
          WHERE application_id = $1
            AND source_stream = $2
            AND source_group = $3
            AND message_id = $4;
          `,
          [event.applicationId, identity.sourceStream, identity.sourceGroup, identity.messageId],
        );
        const existingFingerprint = existing.rows[0]?.fingerprint;

        if (existingFingerprint === undefined) {
          throw new Error(
            "Existing error-group occurrence could not be read after conflict.",
          );
        }

        if (existingFingerprint !== event.fingerprint) {
          throw new Error(
            "Redis message identity was already recorded with a different fingerprint.",
          );
        }

        await client.query("COMMIT");
        return "duplicate";
      }

      await client.query(
        `
        INSERT INTO error_groups (
          application_id,
          fingerprint,
          normalized_message,
          normalizer_version,
          sample_message,
          occurrence_count,
          first_seen,
          last_seen,
          example_trace_id,
          status
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          1,
          $6,
          $6,
          $7,
          'open'
        )
        ON CONFLICT (application_id, fingerprint)
        DO UPDATE SET
          occurrence_count = error_groups.occurrence_count + 1,
          last_seen = EXCLUDED.last_seen,
          example_trace_id = EXCLUDED.example_trace_id,
          updated_at = CURRENT_TIMESTAMP;
        `,
        [
          event.applicationId,
          event.fingerprint,
          normalizedMessage,
          1,
          event.message,
          event.timestamp,
          event.traceId ?? null,
        ],
      );

      await client.query("COMMIT");
      return "recorded";
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the processing failure that caused the rollback.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findAll(applicationId: string): Promise<ErrorGroup[]> {
    const result = await this.database.query<ErrorGroup>(`SELECT
        application_id,
        fingerprint,
    sample_message,
    normalized_message,
    occurrence_count,
    first_seen,
    last_seen,
    example_trace_id,
    status,
    acknowledged_at,
    resolved_at
FROM error_groups
WHERE application_id = $1
ORDER BY occurrence_count DESC;`, [applicationId]);

    return result.rows;
  }

  async findByFingerprint(applicationId: string, fingerprint: string): Promise<ErrorGroup | null> {
    const result = await this.database.query(
      `SELECT
    application_id,
    fingerprint,
    sample_message,
    normalized_message,
    occurrence_count,
    first_seen,
    last_seen,
    example_trace_id,
    status
FROM error_groups
WHERE application_id = $1
  AND fingerprint = $2;`,
      [applicationId, fingerprint],
    );

    return (result.rows[0] as ErrorGroup) ?? null;
  }

  async updateStatus(
    applicationId: string,
    fingerprint: string,
    status: ErrorGroupStatus,
  ): Promise<void> {
    await this.database.query(
      `
    UPDATE error_groups
    SET
      status = $3,

      acknowledged_at =
        CASE
          WHEN $3 = 'acknowledged'
          THEN CURRENT_TIMESTAMP
          ELSE acknowledged_at
        END,

      resolved_at =
        CASE
          WHEN $3 = 'resolved'
          THEN CURRENT_TIMESTAMP
          ELSE resolved_at
        END,

      updated_at = CURRENT_TIMESTAMP

    WHERE application_id = $1
      AND fingerprint = $2;
    `,
      [applicationId, fingerprint, status],
    );
  }
}
