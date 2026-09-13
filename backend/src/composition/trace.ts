import { SpanRepository } from "../repository/span.repository.js";
import { TraceQueryService } from "../services/trace-query.service.js";
import { TraceTreeService } from "../services/trace-tree.service.js";

const repository = new SpanRepository();

const traceTreeService = new TraceTreeService();

export const traceQueryService = new TraceQueryService(
  repository,
  traceTreeService,
);
