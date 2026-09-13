/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("error_group_occurrences", {
    source_stream: {
      type: "text",
      notNull: true,
    },
    source_group: {
      type: "text",
      notNull: true,
    },
    message_id: {
      type: "text",
      notNull: true,
    },
    fingerprint: {
      type: "text",
      notNull: true,
    },
    recorded_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.addConstraint(
    "error_group_occurrences",
    "pk_error_group_occurrences_source_message",
    {
      primaryKey: ["source_stream", "source_group", "message_id"],
    },
  );

  pgm.createIndex("error_group_occurrences", "fingerprint", {
    name: "idx_error_group_occurrences_fingerprint",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("error_group_occurrences");
};
