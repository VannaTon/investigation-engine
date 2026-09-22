import type { Pool } from "pg";
import { postgres } from "../config/postgres.js";
import type {
  Application,
  ApplicationIngestKey,
  ApplicationStatus,
} from "../types/application.js";

type ApplicationDatabase = Pick<Pool, "query">;

type ApplicationRow = {
  id: string;
  name: string;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
};

type ApplicationIngestKeyRow = {
  id: string;
  application_id: string;
  name: string;
  key_prefix: string;
  secret_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export interface ApplicationKeyAuthenticationRecord {
  id: string;
  applicationId: string;
  secretHash: string;
  revokedAt?: string;
  applicationStatus: ApplicationStatus;
}

function mapApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIngestKey(
  row: ApplicationIngestKeyRow,
): ApplicationIngestKey {
  const key: ApplicationIngestKey = {
    id: row.id,
    applicationId: row.application_id,
    name: row.name,
    prefix: row.key_prefix,
    createdAt: row.created_at,
  };

  if (row.last_used_at !== null) {
    key.lastUsedAt = row.last_used_at;
  }
  if (row.revoked_at !== null) {
    key.revokedAt = row.revoked_at;
  }

  return key;
}

const APPLICATION_COLUMNS =
  "id, name, status, created_at, updated_at";
const KEY_COLUMNS =
  "id, application_id, name, key_prefix, secret_hash, " +
  "created_at, last_used_at, revoked_at";

export class ApplicationRepository {
  constructor(
    private readonly database: ApplicationDatabase = postgres,
  ) {}

  async assertStorageReady(): Promise<void> {
    await this.database.query(
      "SELECT id FROM applications ORDER BY created_at ASC LIMIT 1;",
    );
  }

  async create(name: string): Promise<Application> {
    const result = await this.database.query<ApplicationRow>(
      "INSERT INTO applications (name) VALUES ($1) " +
        "RETURNING " +
        APPLICATION_COLUMNS +
        ";",
      [name],
    );
    const row = result.rows[0];

    if (row === undefined) {
      throw new Error("Failed to create application.");
    }

    return mapApplication(row);
  }

  async findAll(): Promise<Application[]> {
    const result = await this.database.query<ApplicationRow>(
      "SELECT " +
        APPLICATION_COLUMNS +
        " FROM applications ORDER BY created_at ASC, id ASC;",
    );

    return result.rows.map(mapApplication);
  }

  async findById(id: string): Promise<Application | null> {
    const result = await this.database.query<ApplicationRow>(
      "SELECT " +
        APPLICATION_COLUMNS +
        " FROM applications WHERE id = $1;",
      [id],
    );
    const row = result.rows[0];

    return row === undefined ? null : mapApplication(row);
  }

  async updateStatus(
    id: string,
    status: ApplicationStatus,
  ): Promise<Application | null> {
    const result = await this.database.query<ApplicationRow>(
      "UPDATE applications SET status = $2, " +
        "updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING " +
        APPLICATION_COLUMNS +
        ";",
      [id, status],
    );
    const row = result.rows[0];

    return row === undefined ? null : mapApplication(row);
  }

  async createIngestKey(input: {
    applicationId: string;
    name: string;
    prefix: string;
    secretHash: string;
  }): Promise<ApplicationIngestKey> {
    const result = await this.database.query<ApplicationIngestKeyRow>(
      "INSERT INTO application_ingest_keys (" +
        "application_id, name, key_prefix, secret_hash" +
        ") VALUES ($1, $2, $3, $4) RETURNING " +
        KEY_COLUMNS +
        ";",
      [
        input.applicationId,
        input.name,
        input.prefix,
        input.secretHash,
      ],
    );
    const row = result.rows[0];

    if (row === undefined) {
      throw new Error("Failed to create application ingestion key.");
    }

    return mapIngestKey(row);
  }

  async listIngestKeys(
    applicationId: string,
  ): Promise<ApplicationIngestKey[]> {
    const result = await this.database.query<ApplicationIngestKeyRow>(
      "SELECT " +
        KEY_COLUMNS +
        " FROM application_ingest_keys " +
        "WHERE application_id = $1 ORDER BY created_at ASC, id ASC;",
      [applicationId],
    );

    return result.rows.map(mapIngestKey);
  }

  async findKeyForAuthentication(
    prefix: string,
  ): Promise<ApplicationKeyAuthenticationRecord | null> {
    const result = await this.database.query<
      ApplicationIngestKeyRow & { application_status: ApplicationStatus }
    >(
      "SELECT k." +
        KEY_COLUMNS.split(", ").join(", k.") +
        ", a.status AS application_status " +
        "FROM application_ingest_keys k " +
        "JOIN applications a ON a.id = k.application_id " +
        "WHERE k.key_prefix = $1;",
      [prefix],
    );
    const row = result.rows[0];

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      applicationId: row.application_id,
      secretHash: row.secret_hash,
      applicationStatus: row.application_status,
      ...(row.revoked_at === null
        ? {}
        : { revokedAt: row.revoked_at }),
    };
  }

  async markKeyUsed(id: string): Promise<void> {
    await this.database.query(
      "UPDATE application_ingest_keys " +
        "SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1;",
      [id],
    );
  }

  async revokeIngestKey(
    applicationId: string,
    keyId: string,
  ): Promise<boolean> {
    const result = await this.database.query(
      "UPDATE application_ingest_keys " +
        "SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) " +
        "WHERE id = $1 AND application_id = $2;",
      [keyId, applicationId],
    );

    return result.rowCount === 1;
  }
}
