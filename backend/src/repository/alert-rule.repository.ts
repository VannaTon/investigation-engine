import { postgres } from "../config/postgres.js";
import type { AlertRule } from "../types/alert.js";

type AlertRuleRow = {
  id: string;
  name: string;
  type: AlertRule["type"];
  enabled: boolean;
  config: AlertRule["config"];
  created_at: string;
  updated_at: string;
};

export class AlertRuleRepository {
  private mapToAlertRule(row: AlertRuleRow): AlertRule {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled,
      config: row.config,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(input: {
    name: string;
    type: AlertRule["type"];
    enabled?: boolean;
    config: AlertRule["config"];
  }): Promise<AlertRule> {
    const result = await postgres.query<AlertRuleRow>(
      `
      INSERT INTO alert_rules (
        name,
        type,
        enabled,
        config
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        name,
        type,
        enabled,
        config,
        created_at,
        updated_at;
      `,
      [
        input.name,
        input.type,
        input.enabled ?? true,
        JSON.stringify(input.config),
      ],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error("Failed to create alert rule.");
    }

    return this.mapToAlertRule(row);
  }

  async findAll(): Promise<AlertRule[]> {
    const result = await postgres.query<AlertRuleRow>(
      `
      SELECT
        id,
        name,
        type,
        enabled,
        config,
        created_at,
        updated_at
      FROM alert_rules
      ORDER BY created_at DESC;
      `,
    );

    return result.rows.map((row) => this.mapToAlertRule(row));
  }

  async findById(id: string): Promise<AlertRule | null> {
    const result = await postgres.query<AlertRuleRow>(
      `
      SELECT
        id,
        name,
        type,
        enabled,
        config,
        created_at,
        updated_at
      FROM alert_rules
      WHERE id = $1;
      `,
      [id],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return this.mapToAlertRule(row);
  }

  async updateEnabled(id: string, enabled: boolean): Promise<AlertRule | null> {
    const result = await postgres.query<AlertRuleRow>(
      `
      UPDATE alert_rules
      SET
        enabled = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING
        id,
        name,
        type,
        enabled,
        config,
        created_at,
        updated_at;
      `,
      [id, enabled],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return this.mapToAlertRule(row);
  }

  async delete(id: string): Promise<boolean> {
    const result = await postgres.query(
      `
      DELETE FROM alert_rules
      WHERE id = $1;
      `,
      [id],
    );

    return result.rowCount === 1;
  }

  async findEnabled(): Promise<AlertRule[]> {
    const result = await postgres.query<AlertRuleRow>(
      `
    SELECT
      id,
      name,
      type,
      enabled,
      config,
      created_at,
      updated_at
    FROM alert_rules
    WHERE enabled = true
    ORDER BY created_at ASC;
    `,
    );

    return result.rows.map((row) => this.mapToAlertRule(row));
  }
}
