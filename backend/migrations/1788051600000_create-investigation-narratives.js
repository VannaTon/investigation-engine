/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("investigation_narratives", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    alert_investigation_id: {
      type: "uuid",
      notNull: true,
      references: "alert_investigations",
      onDelete: "CASCADE",
    },
    evidence_cutoff: {
      type: "timestamptz",
      notNull: true,
    },
    context_hash: {
      type: "text",
      notNull: true,
    },
    generated_at: {
      type: "timestamptz",
      notNull: true,
    },
    narrative: {
      type: "jsonb",
      notNull: true,
    },
  });

  pgm.addConstraint(
    "investigation_narratives",
    "uq_investigation_narratives_investigation_context",
    {
      unique: ["alert_investigation_id", "context_hash"],
    },
  );

  pgm.createIndex(
    "investigation_narratives",
    ["alert_investigation_id", "generated_at"],
    {
      name: "idx_investigation_narratives_generated_at",
    },
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("investigation_narratives");
};
