/* eslint-disable camelcase */

exports.shorthands = undefined;

const LEGACY_UNKNOWN_GENERATION_CONFIG_HASH =
  "e99cd2afb1ad3fbce2b1f3a6ff209440e4592a30df403b596171775fb6c6791e";

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumns("investigation_narratives", {
    generation_config_hash: {
      type: "text",
    },
    model: {
      type: "text",
    },
    provider_base_url: {
      type: "text",
    },
    system_prompt_hash: {
      type: "text",
    },
    prompt_version: {
      type: "text",
    },
    output_contract_version: {
      type: "text",
    },
  });

  pgm.sql(
    "UPDATE investigation_narratives SET generation_config_hash = '" +
      LEGACY_UNKNOWN_GENERATION_CONFIG_HASH +
      "' WHERE generation_config_hash IS NULL",
  );

  pgm.alterColumn(
    "investigation_narratives",
    "generation_config_hash",
    {
      notNull: true,
    },
  );

  pgm.dropConstraint(
    "investigation_narratives",
    "uq_investigation_narratives_investigation_context",
  );

  pgm.addConstraint(
    "investigation_narratives",
    "uq_investigation_narratives_investigation_context_generation_config",
    {
      unique: [
        "alert_investigation_id",
        "context_hash",
        "generation_config_hash",
      ],
    },
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropConstraint(
    "investigation_narratives",
    "uq_investigation_narratives_investigation_context_generation_config",
  );

  pgm.addConstraint(
    "investigation_narratives",
    "uq_investigation_narratives_investigation_context",
    {
      unique: ["alert_investigation_id", "context_hash"],
    },
  );

  pgm.dropColumns("investigation_narratives", [
    "generation_config_hash",
    "model",
    "provider_base_url",
    "system_prompt_hash",
    "prompt_version",
    "output_contract_version",
  ]);
};
