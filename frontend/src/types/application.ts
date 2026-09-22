export type ApplicationStatus = "active" | "disabled";

export interface Application {
  id: string;
  name: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationIngestKey {
  id: string;
  applicationId: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface CreatedApplicationIngestKey extends ApplicationIngestKey {
  key: string;
}

export interface ApplicationDataSource {
  list(signal?: AbortSignal): Promise<Application[]>;
  create(name: string, signal?: AbortSignal): Promise<Application>;
  setStatus(id: string, status: ApplicationStatus, signal?: AbortSignal): Promise<Application>;
  listKeys(applicationId: string, signal?: AbortSignal): Promise<ApplicationIngestKey[]>;
  createKey(applicationId: string, name: string, signal?: AbortSignal): Promise<CreatedApplicationIngestKey>;
  revokeKey(applicationId: string, keyId: string, signal?: AbortSignal): Promise<void>;
}
