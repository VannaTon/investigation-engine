export const LOCAL_DEVELOPMENT_APPLICATION_ID =
  "00000000-0000-4000-8000-000000000001";

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

export interface CreatedApplicationIngestKey
  extends ApplicationIngestKey {
  key: string;
}

export interface ApplicationIdentity {
  applicationId: string;
}

export type ApplicationTelemetry<T> = T & ApplicationIdentity;

export interface AuthenticatedApplication {
  id: string;
  status: ApplicationStatus;
}
