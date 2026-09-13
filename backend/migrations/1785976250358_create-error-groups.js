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
  pgm.createTable("error_groups", {
    fingerprint: {
      type: "text",
      primaryKey: true,
    },

    normalized_message: {
      type: "text",
      notNull: true,
    },

    sample_message: {
      type: "text",
      notNull: true,
    },

    occurrence_count: {
      type: "bigint",
      notNull: true,
      default: 1,
    },

    first_seen: {
      type: "timestamp",
      notNull: true,
    },

    last_seen: {
      type: "timestamp",
      notNull: true,
    },

    example_trace_id: {
      type: "text",
    },

    status: {
      type: "text",
      notNull: true,
      default: "open",
    },

    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },

    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    normalized_message: {
      type: "text",
      notNull: true,
    },

    normalizer_version: {
      type: "integer",
      notNull: true,
      default: 1,
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {};
