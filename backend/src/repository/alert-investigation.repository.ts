import { postgres } from "../config/postgres.js";
import type { LifecycleClient } from "../services/alert-lifecycle-transaction.js";

export type AlertInvestigation = {
  id: string;
  alertId: string;

  defaultWindowFrom: string;
  defaultWindowTo: string | null;

  windowFrom: string | null;
  windowTo: string | null;

  editedAt: string | null;
  finalizedAt: string | null;

  createdAt: string;
  updatedAt: string;
};

type TimestampValue = string | Date;

type AlertInvestigationRow = {
  id: string;
  alert_id: string;

  default_window_from: TimestampValue;
  default_window_to: TimestampValue | null;

  window_from: TimestampValue | null;
  window_to: TimestampValue | null;

  edited_at: TimestampValue | null;
  finalized_at: TimestampValue | null;

  created_at: TimestampValue;
  updated_at: TimestampValue;
};

export class AlertInvestigationRepository {
  private mapToAlertInvestigation(
    row: AlertInvestigationRow,
  ): AlertInvestigation {
    return {
      id: row.id,
      alertId: row.alert_id,

      defaultWindowFrom: toISOString(row.default_window_from),
      defaultWindowTo: toNullableISOString(row.default_window_to),

      windowFrom: toNullableISOString(row.window_from),
      windowTo: toNullableISOString(row.window_to),

      editedAt: toNullableISOString(row.edited_at),
      finalizedAt: toNullableISOString(row.finalized_at),

      createdAt: toISOString(row.created_at),
      updatedAt: toISOString(row.updated_at),
    };
  }

  async create(input: {
    alertId: string;
    defaultWindowFrom: string;
  }): Promise<AlertInvestigation> {
    const result = await postgres.query<AlertInvestigationRow>(
      `
      INSERT INTO alert_investigations (
        alert_id,
        default_window_from
      )
      VALUES ($1, $2)
      RETURNING
        id,
        alert_id,
        default_window_from,
        default_window_to,
        window_from,
        window_to,
        edited_at,
        finalized_at,
        created_at,
        updated_at;
      `,
      [input.alertId, input.defaultWindowFrom],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error("Failed to create alert investigation.");
    }

    return this.mapToAlertInvestigation(row);
  }

  async findByAlertId(alertId: string, client?: LifecycleClient): Promise<AlertInvestigation | null> {
    const result = await (client ?? postgres).query<AlertInvestigationRow>(
      `
      SELECT
        id,
        alert_id,
        default_window_from,
        default_window_to,
        window_from,
        window_to,
        edited_at,
        finalized_at,
        created_at,
        updated_at
      FROM alert_investigations
      WHERE alert_id = $1
      ORDER BY created_at DESC
      LIMIT 1 ${client ? "FOR UPDATE" : ""};
      `,
      [alertId],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return this.mapToAlertInvestigation(row);
  }

  async updateWindow(
    id: string,
    windowFrom: string,
    windowTo: string,
    client?: LifecycleClient,
  ): Promise<AlertInvestigation> {
    const result = await (client ?? postgres).query<AlertInvestigationRow>(
      `
      UPDATE alert_investigations
      SET
        window_from = $2,
        window_to = $3,
        edited_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND finalized_at IS NULL
      RETURNING
        id,
        alert_id,
        default_window_from,
        default_window_to,
        window_from,
        window_to,
        edited_at,
        finalized_at,
        created_at,
        updated_at;
      `,
      [id, windowFrom, windowTo],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error("Alert investigation not found.");
    }

    return this.mapToAlertInvestigation(row);
  }

  async finalize(
    id: string,
    defaultWindowTo: string,
    client?: LifecycleClient,
  ): Promise<AlertInvestigation> {
    const result = await (client ?? postgres).query<AlertInvestigationRow>(
      `
    UPDATE alert_investigations
    SET
      default_window_to = $2,
      window_to = CASE
        WHEN edited_at IS NULL THEN $2
        ELSE window_to
      END,
      finalized_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND finalized_at IS NULL
    RETURNING
      id,
      alert_id,
      default_window_from,
      default_window_to,
      window_from,
      window_to,
      edited_at,
      finalized_at,
      created_at,
      updated_at;
    `,
      [id, defaultWindowTo],
    );

    const row = result.rows[0];

    if (row) {
      return this.mapToAlertInvestigation(row);
    }

    const existingResult = await (client ?? postgres).query<AlertInvestigationRow>(
      `
      SELECT
        id,
        alert_id,
        default_window_from,
        default_window_to,
        window_from,
        window_to,
        edited_at,
        finalized_at,
        created_at,
        updated_at
      FROM alert_investigations
      WHERE id = $1;
      `,
      [id],
    );

    const existingRow = existingResult.rows[0];

    if (!existingRow) {
      throw new Error("Alert investigation not found.");
    }

    return this.mapToAlertInvestigation(existingRow);
  }
}

function toNullableISOString(value: TimestampValue | null): string | null {
  return value === null ? null : toISOString(value);
}

function toISOString(value: TimestampValue): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid alert investigation timestamp: " + String(value));
  }

  return date.toISOString();
}
