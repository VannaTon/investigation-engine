export type StreamProcessingStage =
  | "payload_parse"
  | "clickhouse_save"
  | "error_group_upsert"
  | "alert_evaluation"
  | "redis_ack"
  | "attempt_budget_exhausted"
  | "unknown";

const MAX_ERROR_MESSAGE_LENGTH = 1_024;

export class StreamProcessingError extends Error {
  constructor(
    readonly stage: StreamProcessingStage,
    message: string,
    readonly diagnosticFields: Record<string, unknown> = {},
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "StreamProcessingError";
  }
}

export function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export function streamProcessingStage(error: unknown): StreamProcessingStage {
  return error instanceof StreamProcessingError ? error.stage : "unknown";
}

export function streamProcessingDiagnostics(
  error: unknown,
): Record<string, unknown> {
  return error instanceof StreamProcessingError ? error.diagnosticFields : {};
}
