/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable("alert_rules", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    name: {
      type: "varchar(255)",
      notNull: true,
    },

    type: {
      type: "varchar(50)",
      notNull: true,
    },

    enabled: {
      type: "boolean",
      notNull: true,
      default: true,
    },

    config: {
      type: "jsonb",
      notNull: true,
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },

    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.createTable("alerts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    rule_id: {
      type: "uuid",
      notNull: true,
      references: "alert_rules(id)",
      onDelete: "CASCADE",
    },

    status: {
      type: "varchar(30)",
      notNull: true,
      default: "firing",
    },

    title: {
      type: "varchar(255)",
      notNull: true,
    },

    message: {
      type: "text",
      notNull: true,
    },

    fingerprint: {
      type: "varchar(128)",
    },

    service: {
      type: "varchar(255)",
    },
    trace_id: {
      type: "varchar(255)",
    },

    started_at: {
      type: "timestamptz",
      notNull: true,
    },

    acknowledged_at: {
      type: "timestamptz",
    },

    resolved_at: {
      type: "timestamptz",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },

    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.createIndex("alert_rules", "type");
  pgm.createIndex("alert_rules", "enabled");

  pgm.createIndex("alerts", "rule_id");
  pgm.createIndex("alerts", "status");
  pgm.createIndex("alerts", "fingerprint");
  pgm.createIndex("alerts", "service");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("alerts");
  pgm.dropTable("alert_rules");
};
