/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {Function}
 */
exports.up = (pgm) => {
  // Enable the pgcrypto extension if gen_random_uuid() is needed (pg < 13)
  // pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable("alert_investigations", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    alert_id: {
      type: "uuid",
      notNull: true,
      references: "alerts",
      onDelete: "CASCADE",
    },
    default_window_from: {
      type: "timestamptz",
      notNull: true,
    },
    default_window_to: {
      type: "timestamptz",
      notNull: false,
    },
    window_from: {
      type: "timestamptz",
      notNull: false,
    },
    window_to: {
      type: "timestamptz",
      notNull: false,
    },
    edited_at: {
      type: "timestamptz",
      notNull: false,
    },
    finalized_at: {
      type: "timestamptz",
      notNull: false,
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

  // Create index on alert_id
  pgm.createIndex("alert_investigations", "alert_id", {
    name: "idx_alert_investigations_alert_id",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {Function}
 */
exports.down = (pgm) => {
  // Dropping the table automatically drops associated indexes and constraints
  pgm.dropTable("alert_investigations");
};
