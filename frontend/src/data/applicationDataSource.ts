import { parseTimestamp } from "../lib/formatters";
import type {
  Application,
  ApplicationDataSource,
  ApplicationIngestKey,
  ApplicationStatus,
  CreatedApplicationIngestKey,
} from "../types/application";

export type ApplicationRequestErrorKind =
  | "validation" | "not_found" | "unavailable" | "invalid_response" | "uncertain" | "aborted";

const messages: Record<ApplicationRequestErrorKind, string> = {
  validation: "Review the application details and try again.",
  not_found: "This application or key no longer exists. Refresh the page.",
  unavailable: "Application settings are temporarily unavailable. Check the connection and try again.",
  invalid_response: "Application settings could not be read safely. Refresh before continuing.",
  uncertain: "We could not confirm whether the change was saved. Refresh before trying again.",
  aborted: "The request was cancelled.",
};

export class ApplicationRequestError extends Error {
  constructor(public readonly kind: ApplicationRequestErrorKind, public readonly status?: number) {
    super(messages[kind]);
    this.name = "ApplicationRequestError";
  }
}

export const APPLICATION_REQUEST_TIMEOUT_MS = 15_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyPattern = /^op_ingest_([a-f0-9]{16})_[A-Za-z0-9_-]{43}$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(parseTimestamp(value).getTime());
}

export function parseApplication(value: unknown): Application {
  if (!record(value) || typeof value.id !== "string" || !uuid.test(value.id)
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100
    || (value.status !== "active" && value.status !== "disabled")
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) {
    throw new ApplicationRequestError("invalid_response");
  }
  return {
    id: value.id, name: value.name, status: value.status,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}

export function parseIngestKey(value: unknown, applicationId: string): ApplicationIngestKey {
  if (!record(value) || typeof value.id !== "string" || !uuid.test(value.id)
    || value.applicationId !== applicationId || typeof value.name !== "string"
    || !value.name.trim() || value.name.length > 100
    || typeof value.prefix !== "string" || !/^[a-f0-9]{16}$/.test(value.prefix)
    || !timestamp(value.createdAt)
    || (value.lastUsedAt !== undefined && !timestamp(value.lastUsedAt))
    || (value.revokedAt !== undefined && !timestamp(value.revokedAt))) {
    throw new ApplicationRequestError("invalid_response");
  }
  return {
    id: value.id, applicationId, name: value.name, prefix: value.prefix,
    createdAt: value.createdAt,
    ...(value.lastUsedAt === undefined ? {} : { lastUsedAt: value.lastUsedAt }),
    ...(value.revokedAt === undefined ? {} : { revokedAt: value.revokedAt }),
  };
}

async function request<T>(
  fetchFn: typeof fetch,
  url: string,
  options: RequestInit,
  parse: (payload: unknown) => T,
  write = false,
  noContent = false,
): Promise<T> {
  const signal = options.signal;
  if (signal?.aborted) throw new ApplicationRequestError("aborted");
  const controller = new AbortController();
  let dispatched = false;
  let rejectStopped!: (error: ApplicationRequestError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const stop = (kind: "aborted" | "unavailable") => {
    controller.abort();
    rejectStopped(new ApplicationRequestError(write && dispatched ? "uncertain" : kind));
  };
  const onAbort = () => stop("aborted");
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => stop("unavailable"), APPLICATION_REQUEST_TIMEOUT_MS);
  const work = async (): Promise<T> => {
    let response: Response;
    dispatched = true;
    try { response = await fetchFn(url, { ...options, signal: controller.signal }); }
    catch (error) {
      if (!write && (signal?.aborted || (error instanceof Error && error.name === "AbortError"))) {
        throw new ApplicationRequestError(signal?.aborted ? "aborted" : "unavailable");
      }
      throw new ApplicationRequestError(write ? "uncertain" : "unavailable");
    }
    if (!response.ok) {
      const kind: ApplicationRequestErrorKind = response.status === 400 || response.status === 422
        ? "validation" : response.status === 404 ? "not_found"
        : write && response.status >= 500 ? "uncertain" : "unavailable";
      throw new ApplicationRequestError(kind, response.status);
    }
    if (noContent) {
      if (response.status !== 204) throw new ApplicationRequestError(write ? "uncertain" : "invalid_response");
      return undefined as T;
    }
    try { return parse(await response.json()); }
    catch (error) {
      if (error instanceof ApplicationRequestError && !write) throw error;
      throw new ApplicationRequestError(write ? "uncertain" : signal?.aborted ? "aborted" : "invalid_response");
    }
  };
  try { return await Promise.race([work(), stopped]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function validName(value: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 100) throw new ApplicationRequestError("validation");
  return name;
}

function validId(value: string): void {
  if (!uuid.test(value)) throw new ApplicationRequestError("validation");
}

export class HttpApplicationDataSource implements ApplicationDataSource {
  private readonly endpoint: string;
  constructor(apiBaseUrl: string, private readonly fetchFn: typeof fetch = (...args) => fetch(...args)) {
    this.endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/v1/applications`;
  }

  private json<T>(url: string, method: string, body: unknown, parse: (payload: unknown) => T,
    signal?: AbortSignal): Promise<T> {
    return request(this.fetchFn, url, {
      method, headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body), signal,
    }, parse, true);
  }

  list(signal?: AbortSignal): Promise<Application[]> {
    return request(this.fetchFn, this.endpoint, { headers: { Accept: "application/json" }, signal }, (payload) => {
      if (!Array.isArray(payload)) throw new ApplicationRequestError("invalid_response");
      const applications = payload.map(parseApplication);
      if (new Set(applications.map((item) => item.id)).size !== applications.length) {
        throw new ApplicationRequestError("invalid_response");
      }
      return applications;
    });
  }

  create(name: string, signal?: AbortSignal): Promise<Application> {
    const normalizedName = validName(name);
    return this.json(this.endpoint, "POST", { name: normalizedName }, (payload) => {
      const application = parseApplication(payload);
      if (application.name !== normalizedName || application.status !== "active") {
        throw new ApplicationRequestError("uncertain");
      }
      return application;
    }, signal);
  }

  setStatus(id: string, status: ApplicationStatus, signal?: AbortSignal): Promise<Application> {
    validId(id);
    if (status !== "active" && status !== "disabled") throw new ApplicationRequestError("validation");
    return this.json(`${this.endpoint}/${encodeURIComponent(id)}`, "PATCH", { status }, (payload) => {
      const application = parseApplication(payload);
      if (application.id !== id || application.status !== status) {
        throw new ApplicationRequestError("uncertain");
      }
      return application;
    }, signal);
  }

  listKeys(applicationId: string, signal?: AbortSignal): Promise<ApplicationIngestKey[]> {
    validId(applicationId);
    return request(this.fetchFn, `${this.endpoint}/${encodeURIComponent(applicationId)}/ingest-keys`,
      { headers: { Accept: "application/json" }, signal }, (payload) => {
        if (!Array.isArray(payload)) throw new ApplicationRequestError("invalid_response");
        const keys = payload.map((item) => parseIngestKey(item, applicationId));
        if (new Set(keys.map((item) => item.id)).size !== keys.length) {
          throw new ApplicationRequestError("invalid_response");
        }
        return keys;
      });
  }

  createKey(applicationId: string, name: string, signal?: AbortSignal): Promise<CreatedApplicationIngestKey> {
    validId(applicationId);
    const normalizedName = validName(name);
    return this.json(`${this.endpoint}/${encodeURIComponent(applicationId)}/ingest-keys`, "POST",
      { name: normalizedName }, (payload) => {
        const metadata = parseIngestKey(payload, applicationId);
        const rawKey = record(payload) && typeof payload.key === "string" ? payload.key : undefined;
        const keyMatch = rawKey ? keyPattern.exec(rawKey) : null;
        if (!rawKey || !keyMatch) {
          throw new ApplicationRequestError("invalid_response");
        }
        if (metadata.name !== normalizedName || keyMatch[1] !== metadata.prefix) {
          throw new ApplicationRequestError("uncertain");
        }
        return { ...metadata, key: rawKey };
      }, signal);
  }

  revokeKey(applicationId: string, keyId: string, signal?: AbortSignal): Promise<void> {
    validId(applicationId); validId(keyId);
    return request(this.fetchFn,
      `${this.endpoint}/${encodeURIComponent(applicationId)}/ingest-keys/${encodeURIComponent(keyId)}`,
      { method: "DELETE", headers: { Accept: "application/json" }, signal }, () => undefined,
      true, true);
  }
}
