import { postgres } from "../config/postgres.js";
import type { LifecycleClient } from "../services/alert-lifecycle-transaction.js";
import type { Alert, AlertStatus } from "../types/alert.js";

type AlertRow = {
  id: string;
  application_id: string;
  rule_id: string;
  status: AlertStatus;
  title: string;
  message: string;
  fingerprint: string | null;
  service: string | null;
  trace_id: string | null;
  started_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export class AlertRepository {
  private mapToAlert(row: AlertRow): Alert {
    const alert: Alert = {
      id: row.id,
      applicationId: row.application_id,
      ruleId: row.rule_id,
      status: row.status,
      title: row.title,
      message: row.message,
      startedAt: row.started_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.fingerprint !== null) {
      alert.fingerprint = row.fingerprint;
    }

    if (row.service !== null) {
      alert.service = row.service;
    }

    if (row.trace_id !== null) {
      alert.traceId = row.trace_id;
    }

    if (row.acknowledged_at !== null) {
      alert.acknowledgedAt = row.acknowledged_at;
    }

    if (row.resolved_at !== null) {
      alert.resolvedAt = row.resolved_at;
    }

    return alert;
  }

  async create(input: {
    ruleId: string;
    applicationId: string;
    title: string;
    message: string;
    fingerprint?: string;
    service?: string;
    traceId?: string;
    startedAt: string;
  }): Promise<Alert> {
    const result = await postgres.query<AlertRow>(
      `
      INSERT INTO alerts (
        application_id,
        rule_id,
        status,
        title,
        message,
        fingerprint,
        service,
        trace_id,
        started_at
      )
      VALUES (
        $1,
        $2,
        'firing',
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      )
      RETURNING
        id,
        application_id,
        rule_id,
        status,
        title,
        message,
        fingerprint,
        service,
        trace_id,
        started_at,
        acknowledged_at,
        resolved_at,
        created_at,
        updated_at;
      `,
      [
        input.applicationId,
        input.ruleId,
        input.title,
        input.message,
        input.fingerprint ?? null,
        input.service ?? null,
        input.traceId ?? null,
        input.startedAt,
      ],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error("Failed to create alert.");
    }

    return this.mapToAlert(row);
  }

  async findAll(): Promise<Alert[]> {
    const result = await postgres.query<AlertRow>(
      `
      SELECT
        id,
        application_id,
        rule_id,
        status,
        title,
        message,
        fingerprint,
        service,
        trace_id,
        started_at,
        acknowledged_at,
        resolved_at,
        created_at,
        updated_at
      FROM alerts
      ORDER BY created_at DESC;
      `,
    );

    return result.rows.map((row) => this.mapToAlert(row));
  }

  async findById(id: string, client?: LifecycleClient): Promise<Alert | null> {
    const result = await (client ?? postgres).query<AlertRow>(
      `
      SELECT
        id,
        application_id,
        rule_id,
        status,
        title,
        message,
        fingerprint,
        service,
        trace_id,
        started_at,
        acknowledged_at,
        resolved_at,
        created_at,
        updated_at
      FROM alerts
      WHERE id = $1 ${client ? "FOR UPDATE" : ""};
      `,
      [id],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return this.mapToAlert(row);
  }

  async updateStatus(id: string, status: AlertStatus, client?: LifecycleClient): Promise<Alert | null> {
    let result;

    if (status === "acknowledged") {
      result = await (client ?? postgres).query<AlertRow>(
        `
        UPDATE alerts
        SET
          status = $2,
          acknowledged_at = CASE WHEN status = 'acknowledged' THEN acknowledged_at ELSE CURRENT_TIMESTAMP END,
          updated_at = CASE WHEN status = 'acknowledged' THEN updated_at ELSE CURRENT_TIMESTAMP END
        WHERE id = $1 AND status IN ('firing', 'acknowledged')
        RETURNING
          id,
          application_id,
          rule_id,
          status,
          title,
          message,
          fingerprint,
          service,
          trace_id,
          started_at,
          acknowledged_at,
          resolved_at,
          created_at,
          updated_at;
        `,
        [id, status],
      );
    } else if (status === "resolved") {
      result = await (client ?? postgres).query<AlertRow>(
        `
        UPDATE alerts
        SET
          status = $2,
          resolved_at = CASE
            WHEN status = 'resolved' AND resolved_at IS NOT NULL
              THEN resolved_at
            ELSE CURRENT_TIMESTAMP
          END,
          updated_at = CASE
            WHEN status = 'resolved' AND resolved_at IS NOT NULL
              THEN updated_at
            ELSE CURRENT_TIMESTAMP
          END
        WHERE id = $1 AND status IN ('firing', 'acknowledged', 'resolved')
        RETURNING
          id,
          application_id,
          rule_id,
          status,
          title,
          message,
          fingerprint,
          service,
          trace_id,
          started_at,
          acknowledged_at,
          resolved_at,
          created_at,
          updated_at;
        `,
        [id, status],
      );
    } else {
      result = await (client ?? postgres).query<AlertRow>(
        `
        UPDATE alerts
        SET
          status = $2,
          updated_at = updated_at
        WHERE id = $1 AND status = 'firing' AND $2 = 'firing'
        RETURNING
          id,
          application_id,
          rule_id,
          status,
          title,
          message,
          fingerprint,
          service,
          trace_id,
          started_at,
          acknowledged_at,
          resolved_at,
          created_at,
          updated_at;
        `,
        [id, status],
      );
    }

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return this.mapToAlert(row);
  }

  async findActiveByRuleId(ruleId: string): Promise<Alert | null> {
    const result = await postgres.query<AlertRow>(
      `
    SELECT
      id,
      application_id,
      rule_id,
      status,
      title,
      message,
      fingerprint,
      service,
      trace_id,
      started_at,
      acknowledged_at,
      resolved_at,
      created_at,
      updated_at
    FROM alerts
    WHERE rule_id = $1
      AND status IN ('firing', 'acknowledged')
    ORDER BY created_at DESC
    LIMIT 1;
    `,
      [ruleId],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return this.mapToAlert(row);
  }

  async findActive(): Promise<Alert[]> {
    const result = await postgres.query(
      `
    SELECT
      id,
      application_id,
      rule_id,
      status,
      title,
      message,
      fingerprint,
      service,
      trace_id,
      started_at,
      acknowledged_at,
      resolved_at,
      created_at,
      updated_at
    FROM alerts
    WHERE status IN ('firing', 'acknowledged')
    ORDER BY created_at ASC;
    `,
    );

    return result.rows.map((row) => this.mapToAlert(row));
  }
}
