import type { LogEvent } from "../../types/log-event.js";
import { LogRepository } from "../../repository/log.repository.js";
import type { Processor, StreamProcessingContext } from "./processor.js";
import { normalizeError } from "../../error/normalize.js";
import { generateFingerprint } from "../../error/fingerprint.js";
import type { ErrorGroupRepository } from "../../repository/error-group.repository.js";
import {
  StreamProcessingError,
  boundedErrorMessage,
} from "../stream-processing.error.js";

export function logInsertDeduplicationToken(messageId: string): string {
  return "logs:log-workers:" + messageId;
}

function identity(event: LogEvent): Record<string, string> {
  return {
    service: event.service,
    level: event.level,
    ...(event.traceId === undefined ? {} : { traceId: event.traceId }),
  };
}

export interface LogProcessorOptions {
  replayProtectionEnabled?: boolean;
}

export class LogProcessor implements Processor<LogEvent> {
  constructor(
    private readonly repository: LogRepository,
    private readonly errorGroupRepository: ErrorGroupRepository,
    private readonly options: LogProcessorOptions = {},
  ) {}

  async process(
    event: LogEvent,
    context: StreamProcessingContext,
  ): Promise<void> {
    const startedAt = Date.now();
    let normalized: string | undefined;

    if (event.level === "error") {
      normalized = normalizeError(event.message, event.stackTrace);
      event.fingerprint = generateFingerprint(normalized);
    }

    const diagnosticFields = {
      messageId: context.messageId,
      ...identity(event),
      ...(event.fingerprint === undefined
        ? {}
        : { fingerprint: event.fingerprint }),
    };
    const saveStartedAt = Date.now();

    try {
      await this.repository.save(event, {
        deduplicationToken: logInsertDeduplicationToken(context.messageId),
      });
    } catch (error) {
      throw new StreamProcessingError(
        "clickhouse_save",
        boundedErrorMessage(error),
        {
          ...diagnosticFields,
          stageDurationMs: Date.now() - saveStartedAt,
        },
        { cause: error },
      );
    }

    console.log(
      JSON.stringify({
        event: "log_processing_stage_completed",
        stage: "clickhouse_save",
        stageDurationMs: Date.now() - saveStartedAt,
        ...diagnosticFields,
      }),
    );

    if (normalized !== undefined) {
      const upsertStartedAt = Date.now();

      try {
        const occurrenceResult = this.options.replayProtectionEnabled
          ? await this.errorGroupRepository.upsertOnce(
              event,
              normalized,
              {
                sourceStream: context.streamName,
                sourceGroup: context.groupName,
                messageId: context.messageId,
              },
            )
          : await this.errorGroupRepository
              .upsert(event, normalized)
              .then(() => "untracked" as const);

        console.log(
          JSON.stringify({
            event: "log_processing_stage_completed",
            stage: "error_group_upsert",
            occurrenceResult,
            stageDurationMs: Date.now() - upsertStartedAt,
            ...diagnosticFields,
          }),
        );
      } catch (error) {
        throw new StreamProcessingError(
          "error_group_upsert",
          boundedErrorMessage(error),
          {
            ...diagnosticFields,
            stageDurationMs: Date.now() - upsertStartedAt,
          },
          { cause: error },
        );
      }
    }

    console.log(
      JSON.stringify({
        event: "log_processing_completed",
        totalDurationMs: Date.now() - startedAt,
        ...diagnosticFields,
      }),
    );
  }
}
