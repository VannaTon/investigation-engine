import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { IngestionAuthMode } from "../config/ingestion-auth.js";
import {
  ApplicationRepository,
  type ApplicationKeyAuthenticationRecord,
} from "../repository/application.repository.js";
import {
  LOCAL_DEVELOPMENT_APPLICATION_ID,
  type Application,
  type ApplicationIngestKey,
  type CreatedApplicationIngestKey,
} from "../types/application.js";

const APPLICATION_NAME_MAX_LENGTH = 100;
const KEY_NAME_MAX_LENGTH = 100;
const INGEST_KEY_PATTERN =
  /^op_ingest_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/;

export class ApplicationInputError extends Error {
  constructor(
    readonly statusCode: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationInputError";
  }
}

export type ApplicationAuthenticationFailure =
  | "missing"
  | "malformed"
  | "invalid"
  | "revoked"
  | "application_disabled";

export class ApplicationAuthenticationError extends Error {
  constructor(
    readonly failure: ApplicationAuthenticationFailure,
    readonly statusCode: 401 | 403,
  ) {
    super("Application ingestion authentication failed.");
    this.name = "ApplicationAuthenticationError";
  }
}

type ApplicationRepositoryLike = Pick<
  ApplicationRepository,
  | "create"
  | "findAll"
  | "findById"
  | "updateStatus"
  | "createIngestKey"
  | "listIngestKeys"
  | "findKeyForAuthentication"
  | "markKeyUsed"
  | "revokeIngestKey"
>;

type RandomBytes = (size: number) => Buffer;

function requiredName(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new ApplicationInputError(400, label + " is required.");
  }

  const name = value.trim();

  if (name.length === 0 || name.length > maxLength) {
    throw new ApplicationInputError(
      400,
      label +
        " must contain 1 through " +
        String(maxLength) +
        " characters.",
    );
  }

  return name;
}

export function hashIngestionKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function hashesMatch(actualHash: string, expectedHash: string): boolean {
  if (
    !/^[a-f0-9]{64}$/.test(actualHash) ||
    !/^[a-f0-9]{64}$/.test(expectedHash)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}

export class ApplicationService {
  constructor(
    private readonly repository: ApplicationRepositoryLike,
    private readonly authMode: IngestionAuthMode,
    private readonly secureRandomBytes: RandomBytes = randomBytes,
  ) {}

  create(input: unknown): Promise<Application> {
    const body =
      typeof input === "object" && input !== null
        ? (input as Record<string, unknown>)
        : {};
    return this.repository.create(
      requiredName(body.name, "Application name", APPLICATION_NAME_MAX_LENGTH),
    );
  }

  findAll(): Promise<Application[]> {
    return this.repository.findAll();
  }

  async findById(id: string): Promise<Application> {
    const application = await this.repository.findById(id);

    if (application === null) {
      throw new ApplicationInputError(404, "Application not found.");
    }

    return application;
  }

  async updateStatus(
    id: string,
    value: unknown,
  ): Promise<Application> {
    const body =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {};
    const status = body.status;

    if (status !== "active" && status !== "disabled") {
      throw new ApplicationInputError(
        400,
        "Application status must be active or disabled.",
      );
    }

    const application = await this.repository.updateStatus(id, status);

    if (application === null) {
      throw new ApplicationInputError(404, "Application not found.");
    }

    return application;
  }

  async createIngestKey(
    applicationId: string,
    value: unknown,
  ): Promise<CreatedApplicationIngestKey> {
    await this.findById(applicationId);
    const body =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {};
    const name = requiredName(
      body.name,
      "Key name",
      KEY_NAME_MAX_LENGTH,
    );
    const prefix = this.secureRandomBytes(8).toString("hex");
    const secret = this.secureRandomBytes(32).toString("base64url");
    const key = "op_ingest_" + prefix + "_" + secret;
    const created = await this.repository.createIngestKey({
      applicationId,
      name,
      prefix,
      secretHash: hashIngestionKey(key),
    });

    return { ...created, key };
  }

  async listIngestKeys(
    applicationId: string,
  ): Promise<ApplicationIngestKey[]> {
    await this.findById(applicationId);
    return this.repository.listIngestKeys(applicationId);
  }

  async revokeIngestKey(
    applicationId: string,
    keyId: string,
  ): Promise<void> {
    if (!(await this.repository.revokeIngestKey(applicationId, keyId))) {
      throw new ApplicationInputError(404, "Ingestion key not found.");
    }
  }

  async authenticateAuthorizationHeader(
    authorization: string | undefined,
  ): Promise<string> {
    if (authorization === undefined || authorization.trim() === "") {
      if (this.authMode === "development") {
        return LOCAL_DEVELOPMENT_APPLICATION_ID;
      }

      throw new ApplicationAuthenticationError("missing", 401);
    }

    const bearer = /^Bearer\s+(\S+)$/i.exec(authorization);
    const parsed =
      bearer === null ? null : INGEST_KEY_PATTERN.exec(bearer[1] ?? "");

    if (parsed === null) {
      throw new ApplicationAuthenticationError("malformed", 401);
    }

    const prefix = parsed[1]!;
    const key = bearer![1]!;
    const record =
      await this.repository.findKeyForAuthentication(prefix);

    this.assertUsableAuthenticationRecord(record, key);
    await this.repository.markKeyUsed(record.id);

    return record.applicationId;
  }

  private assertUsableAuthenticationRecord(
    record: ApplicationKeyAuthenticationRecord | null,
    key: string,
  ): asserts record is ApplicationKeyAuthenticationRecord {
    if (
      record === null ||
      !hashesMatch(hashIngestionKey(key), record.secretHash)
    ) {
      throw new ApplicationAuthenticationError("invalid", 401);
    }
    if (record.revokedAt !== undefined) {
      throw new ApplicationAuthenticationError("revoked", 401);
    }
    if (record.applicationStatus !== "active") {
      throw new ApplicationAuthenticationError(
        "application_disabled",
        403,
      );
    }
  }
}
