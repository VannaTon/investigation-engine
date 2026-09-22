import { HistogramMetricRepository } from "../../repository/histogram-metric.repository.js";
import type { HistogramMetricEvent } from "../../types/histogram-metric-event.js";
import {
  StreamProcessingError,
  boundedErrorMessage,
} from "../stream-processing.error.js";
import type { Processor, StreamProcessingContext } from "./processor.js";
import type { ApplicationTelemetry } from "../../types/application.js";

export function histogramMetricInsertDeduplicationToken(
  messageId: string,
): string {
  return "metric_histograms:metric_histogram_workers:" + messageId;
}

function identity(
  event: ApplicationTelemetry<HistogramMetricEvent>,
): Record<string, string> {
  return {
    applicationId: event.applicationId,
    service: event.service,
    name: event.name,
    type: event.type,
    temporality: event.temporality,
  };
}

export class HistogramMetricProcessor
  implements Processor<ApplicationTelemetry<HistogramMetricEvent>>
{
  constructor(private readonly repository: HistogramMetricRepository) {}

  async process(
    event: ApplicationTelemetry<HistogramMetricEvent>,
    context: StreamProcessingContext,
  ): Promise<void> {
    const startedAt = Date.now();
    const diagnosticFields = {
      messageId: context.messageId,
      ...identity(event),
    };

    try {
      await this.repository.save(event, {
        streamMessageId: context.messageId,
        deduplicationToken: histogramMetricInsertDeduplicationToken(
          context.messageId,
        ),
      });
    } catch (error) {
      throw new StreamProcessingError(
        "clickhouse_save",
        boundedErrorMessage(error),
        {
          ...diagnosticFields,
          stageDurationMs: Date.now() - startedAt,
        },
        { cause: error },
      );
    }

    console.log(
      JSON.stringify({
        event: "histogram_metric_processing_completed",
        stage: "clickhouse_save",
        totalDurationMs: Date.now() - startedAt,
        ...diagnosticFields,
      }),
    );
  }
}
