export const shorthands = undefined;

const LOCAL_APPLICATION_ID =
  "00000000-0000-4000-8000-000000000001";

export const up = (pgm) => {
  pgm.createTable("applications", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: {
      type: "varchar(100)",
      notNull: true,
    },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "active",
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
  pgm.addConstraint(
    "applications",
    "applications_status_check",
    { check: "status IN ('active', 'disabled')" },
  );
  pgm.sql(
    "INSERT INTO applications (id, name, status) VALUES (" +
      "'" +
      LOCAL_APPLICATION_ID +
      "', 'Local development', 'active');",
  );

  pgm.createTable("application_ingest_keys", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    application_id: {
      type: "uuid",
      notNull: true,
      references: "applications(id)",
      onDelete: "CASCADE",
    },
    name: {
      type: "varchar(100)",
      notNull: true,
    },
    key_prefix: {
      type: "varchar(16)",
      notNull: true,
      unique: true,
    },
    secret_hash: {
      type: "char(64)",
      notNull: true,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    last_used_at: {
      type: "timestamptz",
    },
    revoked_at: {
      type: "timestamptz",
    },
  });
  pgm.createIndex("application_ingest_keys", "application_id", {
    name: "idx_application_ingest_keys_application_id",
  });

  const scopedTables = [
    "alert_rules",
    "alerts",
    "error_groups",
    "error_group_occurrences",
  ];

  for (const table of scopedTables) {
    pgm.addColumn(table, {
      application_id: {
        type: "uuid",
        notNull: true,
        default: pgm.func("'" + LOCAL_APPLICATION_ID + "'::uuid"),
        references: "applications(id)",
      },
    });
    pgm.sql(
      "ALTER TABLE " +
        table +
        " ALTER COLUMN application_id DROP DEFAULT;",
    );
    pgm.createIndex(table, "application_id", {
      name: "idx_" + table + "_application_id",
    });
  }

  pgm.dropConstraint("error_groups", "error_groups_pkey");
  pgm.addConstraint(
    "error_groups",
    "error_groups_pkey",
    { primaryKey: ["application_id", "fingerprint"] },
  );
};

export const down = (pgm) => {
  pgm.dropConstraint("error_groups", "error_groups_pkey");
  pgm.addConstraint(
    "error_groups",
    "error_groups_pkey",
    { primaryKey: "fingerprint" },
  );

  for (const table of [
    "error_group_occurrences",
    "error_groups",
    "alerts",
    "alert_rules",
  ]) {
    pgm.dropIndex(table, "application_id", {
      name: "idx_" + table + "_application_id",
    });
    pgm.dropColumn(table, "application_id");
  }

  pgm.dropTable("application_ingest_keys");
  pgm.dropTable("applications");
};
