import { SpanRepository } from "../repository/span.repository.js";
import type { Span } from "../types/span.js";
import { TraceTreeService } from "./trace-tree.service.js";

export class TraceQueryService {
  constructor(
    private readonly repository: SpanRepository,
    private readonly traceTreeService: TraceTreeService,
  ) {}
  async find(applicationId: string, traceId: string) {
    const spans = await this.repository.findByTraceId(
      applicationId,
      traceId,
    );
    console.log("spans", spans);

    return this.traceTreeService.build(spans);
  }

  async findForInvestigation(
    applicationId: string,
    traceId: string,
    from: string,
    to: string,
  ) {
    const spans = await this.repository.findByTraceIdForInvestigation(
      applicationId,
      traceId,
      from,
      to,
    );

    return this.traceTreeService.build(spans);
  }
  async save(span: Span & { applicationId: string }) {
    this.repository.save(span);
  }

  async findMany(applicationId: string, traceIds: string[]) {
    const traces = await Promise.all(
      traceIds.map((traceId) => this.find(applicationId, traceId)),
    );

    return traces.flat();
  }

  async findTraceIdsForInvestigation(
    applicationId: string,
    service: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    return this.repository.findTraceIdsForInvestigation(
      applicationId,
      service,
      from,
      to,
    );
  }

  async findCandidateTraceIds(
    applicationId: string,
    service: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    return this.repository.findCandidateTraceIds(
      applicationId,
      service,
      from,
      to,
    );
  }
}
