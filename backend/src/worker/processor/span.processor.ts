import { SpanRepository } from "../../repository/span.repository.js";
import type { Span } from "../../types/span.js";
import type { Processor } from "./processor.js";
import type { ApplicationTelemetry } from "../../types/application.js";

export class SpanProcessor implements Processor<ApplicationTelemetry<Span>> {
  constructor(private readonly repository: SpanRepository) {}

  async process(span: ApplicationTelemetry<Span>): Promise<void> {
    console.log("Processing span:");

    console.log(span);

    await this.repository.save(span);

    console.log("Span stored.");
  }
}
