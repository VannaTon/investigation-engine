import type { MetricEvent } from "../../types/metric-event.js";
import type { Processor, StreamProcessingContext } from "./processor.js";
import { MetricRepository } from "../../repository/metric.repository.js";
import { MetricAlertEvaluator } from "../../services/metric-alert-evaluator.js";
import {
  StreamProcessingError,
  boundedErrorMessage,
} from "../stream-processing.error.js";
import type { ApplicationTelemetry } from "../../types/application.js";

export function metricInsertDeduplicationToken(messageId: string): string {
  return "metrics:metric_workers:" + messageId;
}

function identity(
  event: ApplicationTelemetry<MetricEvent>,
): Record<string, string> {
  return {
    applicationId: event.applicationId,
    service: event.service,
    name: event.name,
    type: event.type,
  };
}

export class MetricProcessor implements Processor<ApplicationTelemetry<MetricEvent>> {
  constructor(
    private readonly repository: MetricRepository,
    private readonly metricAlertEvaluator: MetricAlertEvaluator,
  ) {}

  async process(
    event: ApplicationTelemetry<MetricEvent>,
    context: StreamProcessingContext,
  ): Promise<void> {
    const startedAt = Date.now();
    const diagnosticFields = {
      messageId: context.messageId,
      ...identity(event),
    };
    const saveStartedAt = Date.now();

    try {
      await this.repository.save(event, {
        deduplicationToken: metricInsertDeduplicationToken(context.messageId),
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
        event: "metric_processing_stage_completed",
        stage: "clickhouse_save",
        stageDurationMs: Date.now() - saveStartedAt,
        ...diagnosticFields,
      }),
    );

    const evaluationStartedAt = Date.now();

    try {
      await this.metricAlertEvaluator.evaluate(event);
    } catch (error) {
      throw new StreamProcessingError(
        "alert_evaluation",
        boundedErrorMessage(error),
        {
          ...diagnosticFields,
          stageDurationMs: Date.now() - evaluationStartedAt,
        },
        { cause: error },
      );
    }

    console.log(
      JSON.stringify({
        event: "metric_processing_completed",
        alertEvaluationDurationMs: Date.now() - evaluationStartedAt,
        totalDurationMs: Date.now() - startedAt,
        ...diagnosticFields,
      }),
    );
  }
}
