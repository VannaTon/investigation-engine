import { postgres } from "../config/postgres.js";
import type { Pool } from "pg";
import { NotFoundError } from "../error/not-found.error.js";
import { AlertRuleInputError, alertRuleRevisionToken } from "../services/alert-rule-input.js";
import type { AlertRule, AlertRuleEditContext, AlertRuleReplacement, MetricRuleInput } from "../types/alert.js";

type AlertRuleRow = {
  id: string;
  application_id: string;
  name: string;
  type: AlertRule["type"];
  enabled: boolean;
  config: AlertRule["config"];
  created_at: string;
  updated_at: string;
  revision_epoch?: string;
};

type CreateRuleInput = {
  name: string;
  applicationId: string;
  type: AlertRule["type"];
  enabled?: boolean;
  config: AlertRule["config"];
};

export class AlertRuleRepository {
  constructor(private readonly pool: Pick<Pool, "query" | "connect"> = postgres) {}

  private mapToAlertRule(row: AlertRuleRow): AlertRule {
    return {
      id: row.id,
      applicationId: row.application_id,
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
    applicationId: string;
    type: AlertRule["type"];
    enabled?: boolean;
    config: AlertRule["config"];
  }): Promise<AlertRule> {
    return this.insert(input, this.pool);
  }

  private async insert(input: CreateRuleInput, connection: Pick<Pool, "query">): Promise<AlertRule> {
    const result = await connection.query<AlertRuleRow>(
      `
      INSERT INTO alert_rules (
        application_id,
        name,
        type,
        enabled,
        config
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        application_id,
        name,
        type,
        enabled,
        config,
        created_at,
        updated_at;
      `,
      [
        input.applicationId,
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
    const result = await this.pool.query<AlertRuleRow>(
      `
      SELECT
        id,
        application_id,
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
    const result = await this.pool.query<AlertRuleRow>(
      `
      SELECT
        id,
        application_id,
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
    const result = await this.pool.query<AlertRuleRow>(
      `
      UPDATE alert_rules
      SET
        enabled = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING
        id,
        application_id,
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
    const result = await this.pool.query(
      `
      DELETE FROM alert_rules
      WHERE id = $1;
      `,
      [id],
    );

    return result.rowCount === 1;
  }

  async findEnabled(applicationId: string): Promise<AlertRule[]> {
    const result = await this.pool.query<AlertRuleRow>(
      `
    SELECT
      id,
      application_id,
      name,
      type,
      enabled,
      config,
      created_at,
      updated_at
    FROM alert_rules
    WHERE application_id = $1
      AND enabled = true
    ORDER BY created_at ASC;
    `,
      [applicationId],

    );
    return result.rows.map((row) => this.mapToAlertRule(row));
  }

  private editContextForRow(row: AlertRuleRow): AlertRuleEditContext {
    const rule = this.mapToAlertRule(row);
    if (rule.type !== "metric_threshold") {
      throw new AlertRuleInputError(400, "Only metric threshold rules can be edited here.");
    }
    if (typeof row.revision_epoch !== "string") {
      throw new Error("Missing alert rule revision metadata.");
    }
    return { rule, revisionToken: alertRuleRevisionToken(rule, row.revision_epoch) };
  }

  async editContext(id: string): Promise<AlertRuleEditContext> {
    const result = await this.pool.query<AlertRuleRow>(
      `SELECT id, application_id, name, type, enabled, config, created_at, updated_at,
        EXTRACT(EPOCH FROM updated_at)::text AS revision_epoch
       FROM alert_rules WHERE id = $1;`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Alert rule not found.");
    return this.editContextForRow(row);
  }

  async replace(id: string, input: MetricRuleInput, revisionToken: string): Promise<AlertRuleReplacement> {
    const connection = await this.pool.connect();
    let discarded = false;
    try {
      await connection.query("BEGIN");
      const result = await connection.query<AlertRuleRow>(
        `SELECT id, application_id, name, type, enabled, config, created_at, updated_at,
          EXTRACT(EPOCH FROM updated_at)::text AS revision_epoch
         FROM alert_rules WHERE id = $1 FOR UPDATE;`,
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundError("Alert rule not found.");
      const context = this.editContextForRow(row);
      if (context.revisionToken !== revisionToken) {
        throw new AlertRuleInputError(409, "This rule has changed. Reload it before saving a replacement.");
      }

      // Keep the original name/config and every historical alert reference intact.
      // Advance the precise revision even when the original was already disabled.
      await connection.query(
        `UPDATE alert_rules SET enabled = false,
          updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond')
         WHERE id = $1;`,
        [id],
      );
      const replacement = await this.insert({
        applicationId: context.rule.applicationId,
        name: input.name, type: "metric_threshold", config: input.config, enabled: false,
      }, connection);
      await connection.query("COMMIT");
      return { previousRuleId: id, replacement };
    } catch (error) {
      try {
        await connection.query("ROLLBACK");
      } catch (rollbackError) {
        connection.release(rollbackError instanceof Error ? rollbackError : new Error("Rollback failed"));
        discarded = true;
      }
      throw error;
    } finally {
      if (!discarded) connection.release();
    }
  }
}
