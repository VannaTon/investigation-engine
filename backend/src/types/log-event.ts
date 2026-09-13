export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface ServiceInfo {
  name: string;
  version?: string;
  environment?: string;
}

export interface LogEvent {
  timestamp: string;
  service: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  stackTrace?: string;
  traceId?: string;
  spanId?: string;
  environment?: string;
  metadata?: Record<string, unknown>;
  fingerprint?: string;
}
