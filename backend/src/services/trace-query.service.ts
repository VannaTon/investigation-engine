import { SpanRepository } from "../repository/span.repository.js";
import type { Span } from "../types/span.js";
import { TraceTreeService } from "./trace-tree.service.js";

export class TraceQueryService {
  constructor(
    private readonly repository: SpanRepository,
    private readonly traceTreeService: TraceTreeService,
  ) {}
  async find(traceId: string) {
    const spans = await this.repository.findByTraceId(traceId);
    console.log("spans", spans);

    return this.traceTreeService.build(spans);
  }

  async findForInvestigation(traceId: string, from: string, to: string) {
    const spans = await this.repository.findByTraceIdForInvestigation(
      traceId,
      from,
      to,
    );

    return this.traceTreeService.build(spans);
  }
  async save(span: Span) {
    this.repository.save(span);
  }

  async findMany(traceIds: string[]) {
    const traces = await Promise.all(
      traceIds.map((traceId) => this.find(traceId)),
    );

    return traces.flat();
  }

  async findTraceIdsForInvestigation(
    service: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    return this.repository.findTraceIdsForInvestigation(service, from, to);
  }

  async findCandidateTraceIds(
    service: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    return this.repository.findCandidateTraceIds(service, from, to);
  }
}
